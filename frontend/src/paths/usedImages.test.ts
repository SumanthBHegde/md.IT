import { describe, expect, it } from 'vitest';
import { createPathIndex } from './paths';
import { usedImageIds } from './usedImages';

const index = createPathIndex(
  [
    { id: 'f-notes', parentFolderId: null, name: 'notes' },
    { id: 'f-img', parentFolderId: 'f-notes', name: 'images' },
  ],
  [{ id: 'd1', folderId: 'f-notes', title: 'Plan.md' }],
  [
    { id: 'i-a', folderId: 'f-img', name: 'a.png' },
    { id: 'i-b', folderId: null, name: 'b.png' },
  ],
);

describe('usedImageIds', () => {
  it('finds images through relative and ../ hrefs once each', () => {
    const markdown = '![one](images/a.png)\n\n![again](../notes/images/a.png)\n\n![root](../b.png)\n\n![web](https://x.test/c.png)';
    expect(usedImageIds(markdown, 'f-notes', index)).toEqual(new Set(['i-a', 'i-b']));
  });

  it('ignores missing images and links', () => {
    expect(usedImageIds('![gone](images/zzz.png) [a link](images/a.png)', 'f-notes', index)).toEqual(new Set());
  });
});
