import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { render } from './render';

describe('==highlight==', () => {
  it('renders as <mark> and survives sanitizing', () => {
    expect(render('some ==found== text')).toContain('some <mark>found</mark> text');
  });

  it('keeps inline formatting inside', () => {
    expect(render('==**bold** words==')).toContain('<mark><strong>bold</strong> words</mark>');
  });

  it('leaves equals signs in prose alone', () => {
    const html = render('a == b == c');
    expect(html).not.toContain('<mark>');
    expect(html).toContain('a == b == c');
  });

  it('leaves code spans and math alone', () => {
    expect(render('`==x==`')).toContain('<code>==x==</code>');
    expect(render('$a==b==c$')).not.toContain('<mark>');
  });

  it('counts as plain words in statistics', () => {
    expect(analyze('==two words==').stats.words).toBe(2);
  });
});
