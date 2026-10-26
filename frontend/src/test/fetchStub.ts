/** Test helpers: a fetch that records Requests and answers from a queue. */

type Reply = Response | (() => Promise<Response>);

/** A fetch that records each Request and answers from a queue. */
export function stubFetch(...replies: Reply[]) {
  const seen: Request[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seen.push(input instanceof Request ? input : new Request(input, init));
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    return typeof next === 'function' ? next() : next;
  };
  return { fetchImpl: fetchImpl as typeof fetch, seen };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
