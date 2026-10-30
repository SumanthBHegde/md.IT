import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import taskLists from 'markdown-it-task-lists';
import { codeBlocks } from './code';
import { headings } from './headings';
import { images } from './images';
import { links } from './links';
import { math } from './math';

/** The one markdown-it instance: render() and analyze() must parse identically. */
export const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use(mark);
md.use(taskLists, { enabled: false });
md.use(links);
md.use(images);
md.use(codeBlocks);
md.use(math);
md.use(headings);
