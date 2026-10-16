import type { Mail } from '../mail/mailer';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The invitation to join an organization, plain text and simple HTML. */
export function inviteEmail(to: string, inviter: string, orgName: string, role: string, link: string, days: number): Mail {
  const subject = `${inviter} invited you to ${orgName} on DocCheck`;
  const text = [
    `${inviter} invited you to join ${orgName} on DocCheck as ${role}.`,
    '',
    `Open this link to accept. Sign in, or create an account, with ${to}. It works once, for ${days} days:`,
    link,
    '',
    'If you were not expecting this, ignore this email.',
  ].join('\n');
  const href = escapeHtml(link);
  const html = `<!doctype html>
<html lang="en"><body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2933">
<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(orgName)}</strong> on DocCheck as ${escapeHtml(role)}.</p>
<p><a href="${href}" style="display: inline-block; padding: 10px 16px; background: #1d4ed8; color: #fff; border-radius: 6px; text-decoration: none">Accept the invitation</a></p>
<p>Sign in, or create an account, with ${escapeHtml(to)}. The link works once, for ${days} days. If the button does not work, paste this address into your browser:<br><span style="word-break: break-all">${href}</span></p>
<p style="color: #52606d">If you were not expecting this, ignore this email.</p>
</body></html>`;
  return { to, subject, text, html };
}
