import type { ParamMatcher } from '@sveltejs/kit';

// Only the non-default modes have a URL segment -- `normal` is the bare /, /<date>
// and /archive, so it is matched by the optional param being absent.
//
// Hardcoded rather than derived from $lib/modes: a param matcher has to be
// statically analysable, and this doubles as the guarantee that the segment can
// never be attacker-controlled where it is used as an R2 key prefix.
//
// Written as a type predicate so kit's generated route types narrow the param to
// the literal 'challenger', which makes resolve('/[[mode=mode]]/...', { mode })
// type-check exactly.
export const match = ((param: string): param is 'challenger' =>
    param === 'challenger') satisfies ParamMatcher;
