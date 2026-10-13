import type { Mail } from '../mail/mailer';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The "reset your password" email, plain text and simple HTML. */
export function resetEmail(to: string, link: string, minutes: number): Mail {
  const subject = 'Reset your DocCheck password';
  const text = [
    'Someone (hopefully you) asked to reset the password of your DocCheck account.',
    '',
    `Open this link to choose a new one. It works once, for ${minutes} minutes:`,
    link,
    '',
    'If you did not ask for this, ignore this email: your password stays the same.',
  ].join('\n');
  const href = escapeHtml(link);
  const html = `<!doctype html>
<html lang="en"><body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2933">
<p>Someone (hopefully you) asked to reset the password of your DocCheck account.</p>
<p><a href="${href}" style="display: inline-block; padding: 10px 16px; background: #1d4ed8; color: #fff; border-radius: 6px; text-decoration: none">Choose a new password</a></p>
<p>The link works once, for ${minutes} minutes. If the button does not work, paste this address into your browser:<br><span style="word-break: break-all">${href}</span></p>
<p style="color: #52606d">If you did not ask for this, ignore this email: your password stays the same.</p>
</body></html>`;
  return { to, subject, text, html };
}
