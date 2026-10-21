import 'server-only';
import { chipToken, entityIdFromChipToken } from '@/lib/qloo/resolve';
import { createRunContext } from '@/lib/qloo/client';
import type { QlooService } from '@/lib/qloo';
import type { SearchType } from '@/lib/qloo/types';
import type { ChipOption, ChipResolution, QlooPort } from './ports';

/** Order in which an unknown chip name is searched. Stops at the first type with a usable answer. */
const CHIP_SEARCH_TYPES: readonly SearchType[] = ['artist', 'tv_show', 'brand', 'book', 'movie', 'podcast'];

/** Adapts the Qloo service to the narrow port the agent uses. */
export function createQlooPort(service: QlooService): QlooPort {
  return {
    createRunContext: (deadlineMs) => createRunContext({ deadlineMs }),

    async resolveChip(chip, answer, ctx): Promise<ChipResolution> {
      if (answer) {
        if (entityIdFromChipToken(answer) || service.precache?.chipEntityId(answer)) return { status: 'resolved', token: answer };
        return { status: 'no_match' };
      }
      if (service.precache?.chipEntityId(chip.token) || entityIdFromChipToken(chip.token)) {
        return { status: 'resolved', token: chip.token };
      }
      // Unknown token: search the chip's name. Options are returned for the user to pick, never auto-chosen.
      let lastDetail = 'no_match';
      for (const type of CHIP_SEARCH_TYPES) {
        const out = await service.searchChip(chip.name, type, ctx);
        if (out.pick.kind === 'resolved') return { status: 'resolved', token: chipToken(out.pick.entity.entityId) };
        if (out.pick.kind === 'ambiguous') {
          const options: ChipOption[] = out.pick.options.map((o) => ({
            token: chipToken(o.entityId),
            name: o.name,
            ...(o.disambiguation ? { hint: o.disambiguation } : {}),
          }));
          return { status: 'ambiguous', options };
        }
        if (out.envelope.code !== 'ok' && out.envelope.code !== 'empty') {
          lastDetail = out.envelope.code;
          if (out.envelope.code === 'auth' || out.envelope.code === 'rate_limited') break;
        }
      }
      return lastDetail === 'no_match' ? { status: 'no_match' } : { status: 'unavailable', detail: lastDetail };
    },

    async resolveCandidate(candidate, ctx) {
      const out = await service.resolveCandidate(candidate, ctx);
      switch (out.pick.kind) {
        case 'resolved':
          return { status: 'resolved', matchedName: out.pick.entity.name };
        case 'ambiguous':
          return { status: 'ambiguous' };
        default:
          return out.envelope.code === 'ok' || out.envelope.code === 'empty' ? { status: 'no_match' } : { status: 'unavailable' };
      }
    },

    scoreDomain: (domain, segment, candidates, ctx) => service.scoreDomain(domain, segment, candidates, ctx),
  };
}
