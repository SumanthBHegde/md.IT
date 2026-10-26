import { render, type RenderContext } from '../renderer';
import type { PathIndex } from './paths';

/** Ids of the stored images a document resolves to: rendered with a probing context, so it
 * finds exactly what the preview would show (exports embed them; versions list them). */
export function usedImageIds(markdown: string, folderId: string | null, index: PathIndex): Set<string> {
  const used = new Set<string>();
  const probe: RenderContext = {
    resolveImage(href) {
      const found = index.resolve(folderId, href);
      if (found.kind === 'image') used.add(found.id);
      return { missing: true };
    },
    resolveLink: () => ({ unsupported: true }),
  };
  render(markdown, probe);
  return used;
}
