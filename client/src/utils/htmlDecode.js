// Decode HTML entities like &amp; to &
export const decodeHtml = (html) => {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};
