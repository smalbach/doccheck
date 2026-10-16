import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { appUrl } from '../auth/app-url';
import type { PublicUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { Mailer } from '../mail/mailer';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { inviteEmail } from './invite-email';
import type { OrgContext, OrgSummary } from './org.types';
import type { InviteDto, OrgSettingsDto } from './orgs.dto';
import { OrgsRepository } from './orgs.repository';
import { permissionsOf, type OrgRole } from './permissions';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** How long an emailed invitation works. */
const INVITE_DAYS = 7;

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    private readonly repo: OrgsRepository,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** The user's organizations, the active one first, each with what the user may do there. */
  async mine(userId: string, active: OrgContext | undefined): Promise<{ active?: OrgSummary; items: OrgSummary[] }> {
    const items = (await this.repo.listForUser(userId)).map((o) => ({ ...o, permissions: permissionsOf(o.role) }));
    return { ...(active ? { active: items.find((o) => o.id === active.id) } : {}), items };
  }

  async create(user: PublicUser, name: string, sessionTokenHash?: string): Promise<OrgSummary> {
    const id = await this.repo.create(user.id, name, false);
    await this.repo.switchTo(user.id, id, sessionTokenHash);
    this.audit.note({ orgId: id, action: 'org.create', entity: 'organization', entityId: id, after: { name } });
    return { id, name, personal: false, role: 'owner', members: 1, permissions: permissionsOf('owner') };
  }

  async switchTo(userId: string, orgId: string, sessionTokenHash?: string): Promise<OrgContext> {
    const membership = await this.repo.membership(userId, orgId);
    if (!membership) throw new NotFoundException('Organization not found');
    await this.repo.switchTo(userId, orgId, sessionTokenHash);
    return membership;
  }

  async updateSettings(org: OrgContext, dto: OrgSettingsDto) {
    const before = await this.repo.settings(org.id);
    const after = await this.repo.updateSettings(org.id, dto);
    this.audit.note({ action: 'org.settings', entity: 'organization', entityId: org.id, before, after });
    return after;
  }

  /**
   * Changes a member's role. Only an owner makes or unmakes owners; an admin manages the other
   * roles. The last owner cannot step down (hand ownership to someone first).
   */
  async setRole(org: OrgContext, userId: string, role: OrgRole) {
    const current = await this.repo.memberRole(org.id, userId);
    if (!current) throw new NotFoundException('Member not found');
    if ((role === 'owner' || current === 'owner') && org.role !== 'owner') throw new ForbiddenException('Only an owner can make or change an owner');
    const res = await this.repo.setRole(org.id, userId, role);
    if (res === 'not-found') throw new NotFoundException('Member not found');
    if (res === 'last-owner') throw new ConflictException('The organization needs an owner: make someone else owner first');
    this.audit.note({ action: 'member.role', entity: 'member', entityId: userId, before: { role: current }, after: { role } });
    return this.repo.members(org.id);
  }

  /** Removes a member (or the user themselves: leaving). Their shares and assignments go with them. */
  async remove(org: OrgContext, actor: PublicUser, userId: string) {
    const current = await this.repo.memberRole(org.id, userId);
    if (!current) throw new NotFoundException('Member not found');
    const self = userId === actor.id;
    if (!self && org.role !== 'owner' && org.role !== 'admin') throw new ForbiddenException('Only owners and admins remove members');
    if (!self && current === 'owner' && org.role !== 'owner') throw new ForbiddenException('Only an owner can remove an owner');
    const res = await this.repo.setRole(org.id, userId, null);
    if (res === 'last-owner') throw new ConflictException('The organization needs an owner: make someone else owner first, or delete the organization');
    this.audit.note({ action: self ? 'member.leave' : 'member.remove', entity: 'member', entityId: userId, before: { role: current } });
  }

  async invite(org: OrgContext, actor: PublicUser, dto: InviteDto) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const id = await this.repo.createInvite({ orgId: org.id, email: dto.email, role: dto.role, tokenHash: sha256(token), invitedBy: actor.id, expiresAt });
    this.audit.note({ action: 'member.invite', entity: 'invite', entityId: id, after: { email: dto.email, role: dto.role } });
    const base = appUrl();
    const link = `${base ?? ''}/#/invite?token=${token}`;
    if (!base) this.logger.warn(`APP_URL is not set: the invitation link for ${dto.email} is relative`);
    void this.mailer
      .send(inviteEmail(dto.email, actor.name, org.name, dto.role, link, INVITE_DAYS))
      .catch((err: Error) => this.logger.error(`Invitation email to ${dto.email} failed: ${err.message}`));
    return { id, email: dto.email, role: dto.role, expiresAt: expiresAt.toISOString() };
  }

  async revokeInvite(org: OrgContext, id: string) {
    if (!(await this.repo.deleteInvite(org.id, id))) throw new NotFoundException('Invitation not found');
    this.audit.note({ action: 'member.uninvite', entity: 'invite', entityId: id });
  }

  /** What a link offers, before signing in to accept it (no email is revealed beyond its domain). */
  async peekInvite(token: string) {
    const invite = await this.repo.inviteByToken(sha256(token));
    if (!invite) throw new NotFoundException('This invitation is invalid, expired or already used');
    return { orgName: invite.orgName, role: invite.role, emailDomain: invite.email.split('@')[1] };
  }

  /** Joins the organization of a link sent to the signed-in user's own email, and works there from now on. */
  async acceptInvite(user: PublicUser, token: string, sessionTokenHash?: string) {
    const invite = await this.repo.inviteByToken(sha256(token));
    if (!invite) throw new NotFoundException('This invitation is invalid, expired or already used');
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException(`This invitation is for another email address. Sign in as the invited address to accept it.`);
    if (!(await this.repo.acceptInvite(invite.id, user.id))) throw new NotFoundException('This invitation is invalid, expired or already used');
    await this.repo.switchTo(user.id, invite.orgId, sessionTokenHash);
    this.audit.note({ orgId: invite.orgId, action: 'member.join', entity: 'member', entityId: user.id, after: { role: invite.role, email: user.email } });
    return { orgId: invite.orgId, orgName: invite.orgName };
  }

  /** Shares a shipment with a member whose role is client (read-only on what is shared). */
  async share(org: OrgContext, actor: PublicUser, shipmentId: string, userId: string) {
    const role = await this.repo.memberRole(org.id, userId);
    if (role !== 'client') throw new BadRequestException('Shipments are shared with members whose role is client; other members see every shipment');
    await this.repo.share(shipmentId, userId, actor.id);
    this.audit.note({ action: 'shipment.share', entity: 'shipment', entityId: shipmentId, after: { userId } });
    return this.repo.shares(shipmentId);
  }

  async unshare(shipmentId: string, userId: string) {
    await this.repo.unshare(shipmentId, userId);
    this.audit.note({ action: 'shipment.unshare', entity: 'shipment', entityId: shipmentId, before: { userId } });
    return this.repo.shares(shipmentId);
  }

  /** Deletes the organization with its shipments and PDFs (owners). A personal organization goes with its account. */
  async deleteOrg(org: OrgContext) {
    if (org.personal) throw new BadRequestException('Your personal organization goes when you delete your account');
    const res = await this.repo.deleteOrg(org.id);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; delete the organization when they are done');
    this.audit.note({ action: 'org.delete', entity: 'organization', entityId: org.id, before: { name: org.name } });
    const failed = (await Promise.all(res.keys.map((k) => this.storage.delete(k).then(() => null, (err: Error) => `${k} (${err.message})`)))).filter(Boolean);
    if (failed.length) this.logger.warn(`Organization ${org.id} deleted, but these PDFs could not be removed from storage: ${failed.join(', ')}`);
  }
}
