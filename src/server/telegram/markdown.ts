export function escapeMarkdown(text: string) {
  return text.replace(/[\\_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function captchaMessage(url: string) {
  return `⚠️ *Потрібна перевірка ДТЕК*\n\nПройдіть перевірку за посиланням:\n${escapeMarkdown(url)}`;
}
