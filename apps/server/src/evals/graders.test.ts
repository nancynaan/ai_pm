import { describe, expect, it } from 'vitest';
import type { BacklogDraft } from '../agents/schemas.js';
import { investProblems, uncoveredRequirements } from './graders.js';

const story = (ref: string, blockedBy: string[] = [], userStory?: string) => ({
  ref,
  summary: `Story ${ref} does one clear thing`,
  userStory: userStory ?? 'As a player, I want a chest on the menu, so that I get coins for watching an ad.',
  context: 'The main menu shows the chest next to the play button once it is ready to open.',
  acceptanceCriteria: [
    {
      scenario: 'Chest is ready',
      given: ['the timer has run out'],
      when: ['the menu opens'],
      then: ['the chest glows'],
    },
  ],
  blockedBy,
  openQuestions: [],
});

describe('eval graders', () => {
  it('lists in-scope requirements no story covers', () => {
    const requirements = [
      { code: 'REQ-F-001', moscow: 'must' },
      { code: 'REQ-F-002', moscow: 'should' },
      { code: 'REQ-F-003', moscow: 'wont' },
    ];
    expect(uncoveredRequirements(requirements, [{ requirementCodes: ['REQ-F-001'] }])).toEqual(['REQ-F-002']);
    expect(uncoveredRequirements(requirements, [{ requirementCodes: ['REQ-F-001', 'REQ-F-002'] }])).toEqual(
      [],
    );
  });

  it('passes a clean draft and names each INVEST problem', () => {
    const clean: BacklogDraft = {
      epic: { overview: 'A gift chest on the main menu.', outcome: 'More rewarded ad views.' },
      stories: [story('S-1'), story('S-2', ['S-1'])],
    };
    expect(investProblems(clean, [{ localId: 'S-1', type: 'story', summary: 'S-1', aiEstimate: 3 }])).toEqual([]);

    const bad: BacklogDraft = {
      ...clean,
      stories: [
        story('S-1', ['S-2']),
        story('S-2', ['S-1'], 'As a player, I want a chest on the menu because coins are nice.'),
        {
          ...story('S-3', ['S-1', 'S-2', 'S-4', 'S-5']),
          acceptanceCriteria: [{ scenario: 'x', given: ['a'], when: ['b'], then: [] }],
        },
      ],
    };
    const problems = investProblems(bad, [
      { localId: 'S-3', type: 'story', summary: 'Big', aiEstimate: 21 },
      { localId: 'S-9', type: 'enabler', summary: 'Unknown', aiEstimate: null },
    ]);
    expect(problems.map((p) => p.split(':')[0])).toEqual([
      'Independent',
      'Valuable',
      'Independent',
      'Testable',
      'Small',
      'Estimable',
    ]);
  });
});
