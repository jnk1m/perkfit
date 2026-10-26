import { CANDIDATES, DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { PerkFitApp } from '@/components/PerkFitApp';
import { exampleHeroPoints, liveConfigured } from '@/lib/ui/serverSeams';

export default async function Page() {
  const heroPoints = await exampleHeroPoints();
  return (
    <PerkFitApp
      examples={EXAMPLE_SEGMENTS}
      candidates={CANDIDATES}
      defaultBudget={DEFAULT_BUDGET}
      defaultMembers={DEFAULT_MEMBERS}
      liveAvailable={liveConfigured()}
      heroPoints={heroPoints}
    />
  );
}
