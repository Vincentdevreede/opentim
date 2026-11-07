/**
 * The text a test reads from server-rendered HTML: comments and tags are left out, each tag counts as a space, and runs
 * of white space become one space. It reads the string once from left to right, so a comment that spans lines or a
 * tag inside one is skipped whole.
 */
export function visibleText(html: string): string {
  let text = "";
  let at = 0;
  while (at < html.length) {
    if (html.startsWith("<!--", at)) {
      const end = html.indexOf("-->", at + 4);
      at = end < 0 ? html.length : end + 3;
    } else if (html[at] === "<") {
      const end = html.indexOf(">", at + 1);
      at = end < 0 ? html.length : end + 1;
      text += " ";
    } else text += html[at++];
  }
  return text.split(/\s+/).join(" ");
}
