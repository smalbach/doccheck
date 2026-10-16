/**
 * The HTML part of every email DocCheck sends: the mark and name on top, the message, and a footer
 * saying how to answer. The plain-text part stays as written; this only lays it out. Inline styles and
 * tables, as mail clients need; the logo goes as an inline (cid:) image, which Gmail and Outlook show
 * without asking, unlike remote images.
 */

export const LOGO_CID = 'logo@doccheck';

const FOOTER: Record<string, { reply: string; sent: string }> = {
  en: { reply: 'Reply to this email, with the corrected documents attached if there are any: your answer goes straight to this conversation.', sent: 'Sent with DocCheck' },
  es: { reply: 'Responde a este correo, con los documentos corregidos adjuntos si los hay: tu respuesta llega directo a esta conversación.', sent: 'Enviado con DocCheck' },
  fr: { reply: 'Répondez à ce courriel, avec les documents corrigés en pièce jointe s’il y en a : votre réponse arrive directement dans cette conversation.', sent: 'Envoyé avec DocCheck' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes, then turns http(s) links into anchors (the text part keeps them bare). */
function inline(s: string): string {
  return esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:#0f766e;font-weight:600">${url}</a>`);
}

/**
 * Lines of the text body as HTML. A numbered line ("1. ...") starts a boxed item; an indented "- ..."
 * line is a value under it; another indented line with "Label: text" is a note. Everything else is a
 * paragraph line.
 */
function bodyHtml(text: string): string {
  const out: string[] = [];
  let item: string[] | null = null;
  const closeItem = () => {
    if (item) out.push(`<div style="margin:14px 0;padding:12px 14px;border:1px solid #e2e5e9;border-left:4px solid #0f766e;border-radius:8px;background:#f8fafb">${item.join('')}</div>`);
    item = null;
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const numbered = /^(\d+)\.\s+(.*)$/.exec(raw);
    const value = /^\s+[-–•]\s+(.*)$/.exec(raw);
    const note = /^\s+(\S[^:]{0,40}):\s+(.*)$/.exec(raw);
    if (numbered) {
      closeItem();
      item = [`<div style="font-weight:600;color:#1c2024;margin-bottom:6px">${esc(numbered[1]!)}. ${inline(numbered[2]!)}</div>`];
    } else if (item && value) {
      const [label, ...rest] = value[1]!.split(/:\s(.*)/s);
      item.push(
        `<div style="font-size:13px;color:#5b626a;margin:3px 0 3px 4px">${inline(label!)}${rest[0] !== undefined ? `: <code style="font-family:Menlo,Consolas,monospace;font-size:13px;color:#1c2024;background:#eef1f3;padding:1px 5px;border-radius:4px">${esc(rest[0])}</code>` : ''}</div>`,
      );
    } else if (item && note) {
      item.push(`<div style="font-size:14px;margin-top:8px"><strong>${esc(note[1]!)}:</strong> ${inline(note[2]!)}</div>`);
    } else if (item && raw.trim()) {
      item.push(`<div style="font-size:14px;margin-top:6px">${inline(raw.trim())}</div>`);
    } else {
      closeItem();
      out.push(raw.trim() ? `<p style="margin:0 0 4px">${inline(raw)}</p>` : '<div style="height:10px;line-height:10px">&nbsp;</div>');
    }
  }
  closeItem();
  return out.join('\n');
}

export interface MailHtmlInput {
  subject: string;
  text: string;
  language?: string | null;
  /** The reference in the subject ("DC-k3x9p2"), shown small in the footer. */
  tag?: string | null;
  /** Where the logo comes from: `cid:` when sending, a data URL in the preview. */
  logoSrc?: string;
}

export function mailHtml({ subject, text, language, tag, logoSrc = `cid:${LOGO_CID}` }: MailHtmlInput): string {
  const lang = language && FOOTER[language] ? language : 'en';
  const footer = FOOTER[lang]!;
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f8">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e5e9;border-radius:10px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e2e5e9">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="${logoSrc}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px"></td>
<td style="vertical-align:middle;padding-left:10px;font:700 17px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024">DocCheck</td>
</tr></table>
</td></tr>
<tr><td style="padding:22px 24px;font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024">
${bodyHtml(text)}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e5e9;background:#f8fafb;border-radius:0 0 10px 10px;font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#5b626a">
${esc(footer.reply)}
<div style="margin-top:8px;font-size:12px;color:#8a9097">${esc(footer.sent)}${tag ? ` · ${esc(tag)}` : ''}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
