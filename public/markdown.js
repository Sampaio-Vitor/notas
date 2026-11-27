// Markdown for the Notas tab, over the vendored markdown-it. A note's text comes from the person
// and from agents, which may be repeating something read on the web, so nothing in it becomes
// markup of its own: HTML is shown as text, a link only goes to http(s) or mailto and opens
// outside the app, and an image is a link (the page's CSP would not load it anyway).
export function createMarkdown(MarkdownIt, {check = ''} = {}) {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true});
  const esc = md.utils.escapeHtml;
  md.validateLink = url => /^(https?:\/\/|mailto:)/i.test(String(url).trim());
  const linkOpen = md.renderer.rules.link_open || ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
    return linkOpen(tokens, i, options, env, self);
  };
  md.renderer.rules.image = (tokens, i, options, env, self) => {
    const src = tokens[i].attrGet('src') || '', alt = self.renderInlineAsText(tokens[i].children || [], options, env);
    return `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(alt || src)}</a>`;
  };
  // A wide table scrolls sideways inside its own box instead of stretching the page.
  md.renderer.rules.table_open = () => '<div class="n-md-table"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  // "- [ ] comprar" and "- [x] feito": the app's circle instead of the bullet. The button carries
  // the line of the Markdown it came from, so tapping it can rewrite that line (toggleMemoTask).
  md.core.ruler.after('inline', 'memo_tasks', state => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i], item = tokens[i - 2];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || item.type !== 'list_item_open' || !item.map) continue;
      const first = inline.children?.[0], mark = first?.type === 'text' ? /^\[([ xX])\](?:\s+|$)/.exec(first.content) : null;
      if (!mark) continue;
      const done = mark[1] !== ' ';
      first.content = first.content.slice(mark[0].length);
      item.attrJoin('class', done ? 'n-md-task is-done' : 'n-md-task');
      const box = new state.Token('html_inline', '', 0), open = new state.Token('html_inline', '', 0), close = new state.Token('html_inline', '', 0);
      box.content = `<button type="button" class="n-check" data-md-task="${item.map[0]}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar como feito'}">${check}</button>`;
      open.content = '<span class="n-md-task-t">';
      close.content = '</span>';
      inline.children.unshift(box, open);
      inline.children.push(close);
    }
  });
  return {render: text => md.render(String(text || ''))};
}
