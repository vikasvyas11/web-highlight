// Index the page's text nodes without wrapping them or changing the site's DOM.
const UnderlightAnchors = (() => {
  const excluded = "script,style,noscript,template,textarea,input,select,button,[hidden],[inert],[aria-hidden='true'],[contenteditable]:not([contenteditable='false']),underlight-panel";

  function index() {
    const nodes = [];
    const offsets = new Map();
    const pieces = [];
    let length = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        return node.matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push(node);
      offsets.set(node, length);
      pieces.push(node.data);
      length += node.length;
    }
    return { nodes, offsets, text: pieces.join("") };
  }

  function capture(range, idx) {
    const { nodes, offsets, text } = idx;
    // Element endpoints can occur with select-all or selections across inline tags.
    const first = offsets.has(range.startContainer) ? range.startContainer : nodes.find(n => range.intersectsNode(n));
    const last = offsets.has(range.endContainer) ? range.endContainer : nodes.findLast(n => range.intersectsNode(n));
    if (!first || !last) return null;
    const start = offsets.get(first) + (first === range.startContainer ? range.startOffset : 0);
    const end = offsets.get(last) + (last === range.endContainer ? range.endOffset : last.length);
    const exact = text.slice(start, end);
    if (!exact.trim() || exact !== range.toString()) return null;
    return { start, exact, before: text.slice(Math.max(0, start - 64), start), after: text.slice(end, end + 64) };
  }

  function locate(anchor, text) {
    const { exact, before, after } = anchor;
    let best = -1, bestScore = -1;
    if (!exact) return -1;
    for (let at = text.indexOf(exact); at !== -1; at = text.indexOf(exact, at + 1)) {
      let left = 0, right = 0;
      while (left < before.length && before[before.length - left - 1] === text[at - left - 1]) left++;
      while (right < after.length && after[right] === text[at + exact.length + right]) right++;
      const score = left + right;
      if (score > bestScore) { best = at; bestScore = score; }
      else if (score === bestScore) best = -1;
      // Identical long passages can legitimately have matching context at several offsets.
      if (at === anchor.start && left === before.length && right === after.length) return at;
    }
    return best;
  }

  function resolve(anchor, idx) {
    const start = locate(anchor, idx.text);
    if (start < 0) return null;
    function endpoint(position) {
      let lo = 0, hi = idx.nodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (idx.offsets.get(idx.nodes[mid]) <= position) lo = mid;
        else hi = mid - 1;
      }
      return idx.nodes[lo];
    }
    const end = start + anchor.exact.length;
    const first = endpoint(start), last = endpoint(end - 1);
    const range = document.createRange();
    range.setStart(first, start - idx.offsets.get(first));
    range.setEnd(last, end - idx.offsets.get(last));
    return range;
  }
  return { index, capture, resolve, excluded };
})();
