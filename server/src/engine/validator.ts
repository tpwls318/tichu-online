import { Card } from '../types/game.js';

export type ComboType = 
  | 'Single'
  | 'Pair'
  | 'ConsecutivePairs'
  | 'Triple'
  | 'FullHouse'
  | 'Straight'
  | 'BombQuartet'
  | 'BombStraightFlush'
  | 'Dog'
  | 'Invalid';

export interface Combination {
  type: ComboType;
  value: number;
  length: number;
  cards: Card[];
}

export class HandValidator {
  static validate(cards: Card[]): Combination {
    if (cards.length === 0) return { type: 'Invalid', value: 0, length: 0, cards };
    
    const phoenixIndex = cards.findIndex(c => c.value === 16);
    
    // Single Phoenix
    if (cards.length === 1 && phoenixIndex !== -1) {
      return { type: 'Single', value: 1.5, length: 1, cards };
    }

    if (phoenixIndex !== -1) {
      const normalCards = cards.filter(c => c.value !== 16);
      let bestCombo: Combination = { type: 'Invalid', value: 0, length: 0, cards };
      // Phoenix cannot substitute for Special cards (1, 15), only 2-14
      for (let subValue = 2; subValue <= 14; subValue++) {
        const mockPhoenix: Card = { suit: 'Special', value: subValue, id: 'PhoenixMock' };
        const testCards = [...normalCards, mockPhoenix];
        const result = HandValidator.checkStandardCombos(testCards, cards);
        if (result.type !== 'Invalid' && !result.type.startsWith('Bomb')) {
          if (result.value > bestCombo.value) {
            bestCombo = result;
          }
        }
      }
      return bestCombo;
    }

    // No Phoenix, just normal validation
    return HandValidator.checkStandardCombos(cards, cards);
  }

  private static checkStandardCombos(testCards: Card[], originalCards: Card[]): Combination {
    if (testCards.length === 0) return { type: 'Invalid', value: 0, length: 0, cards: originalCards };
    const sorted = [...testCards].sort((a, b) => a.value - b.value);
    const length = testCards.length;

    // Bomb (Quartet)
    if (length === 4 && sorted[0]?.value === sorted[1]?.value && sorted[1]?.value === sorted[2]?.value && sorted[2]?.value === sorted[3]?.value) {
      return { type: 'BombQuartet', value: sorted[0]!.value, length: 4, cards: originalCards };
    }

    // Straight / Straight Flush (5+ cards)
    if (length >= 5) {
      let isStraight = true;
      let isFlush = true;
      const firstSuit = sorted[0]!.suit;
      
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.value !== sorted[i - 1]!.value + 1) {
          isStraight = false;
        }
        if (sorted[i]!.suit !== firstSuit) {
          isFlush = false;
        }
      }
      
      if (isStraight) {
        if (isFlush) return { type: 'BombStraightFlush', value: sorted[sorted.length - 1]!.value, length, cards: originalCards };
        return { type: 'Straight', value: sorted[sorted.length - 1]!.value, length, cards: originalCards };
      }
    }

    // Single
    if (length === 1) {
      if (sorted[0]!.value === 0) return { type: 'Dog', value: 0, length: 1, cards: originalCards };
      return { type: 'Single', value: sorted[0]!.value, length: 1, cards: originalCards };
    }

    // Pair
    if (length === 2 && sorted[0]?.value === sorted[1]?.value) {
      return { type: 'Pair', value: sorted[0]!.value, length: 2, cards: originalCards };
    }

    // Triple
    if (length === 3 && sorted[0]?.value === sorted[1]?.value && sorted[1]?.value === sorted[2]?.value) {
      return { type: 'Triple', value: sorted[0]!.value, length: 3, cards: originalCards };
    }

    // Full House (3 + 2)
    if (length === 5) {
      if (sorted[0]?.value === sorted[1]?.value && sorted[1]?.value === sorted[2]?.value && sorted[3]?.value === sorted[4]?.value) {
        return { type: 'FullHouse', value: sorted[0]!.value, length: 5, cards: originalCards };
      }
      if (sorted[0]?.value === sorted[1]?.value && sorted[2]?.value === sorted[3]?.value && sorted[3]?.value === sorted[4]?.value) {
        return { type: 'FullHouse', value: sorted[2]!.value, length: 5, cards: originalCards };
      }
    }

    // Consecutive Pairs (2+ pairs)
    if (length >= 4 && length % 2 === 0) {
      let isConsecutive = true;
      for (let i = 0; i < sorted.length; i += 2) {
        if (sorted[i]?.value !== sorted[i + 1]?.value) {
          isConsecutive = false;
          break;
        }
        if (i > 0 && sorted[i]?.value !== sorted[i - 2]!.value + 1) {
          isConsecutive = false;
          break;
        }
      }
      if (isConsecutive) {
        return { type: 'ConsecutivePairs', value: sorted[sorted.length - 1]!.value, length, cards: originalCards };
      }
    }

    return { type: 'Invalid', value: 0, length: 0, cards: originalCards };
  }

  static compare(prev: Combination, current: Combination): boolean {
    if (current.type === 'Invalid') return false;
    
    const isPrevBomb = prev.type.startsWith('Bomb');
    const isCurrentBomb = current.type.startsWith('Bomb');

    if (isCurrentBomb) {
      if (!isPrevBomb) return true;
      if (current.type === 'BombQuartet' && prev.type === 'BombQuartet') {
        return current.value > prev.value;
      }
      if (current.type === 'BombStraightFlush' && prev.type === 'BombQuartet') return true;
      if (current.type === 'BombStraightFlush' && prev.type === 'BombStraightFlush') {
        if (current.length !== prev.length) return current.length > prev.length;
        return current.value > prev.value;
      }
    }

    if (isPrevBomb) return false;
    if (prev.type !== current.type) return false;
    if (prev.length !== current.length) return false;

    // Special logic for Single Phoenix
    if (current.type === 'Single' && current.cards[0].value === 16) {
      // Phoenix played over a normal single. It beats anything except Dragon (15).
      if (prev.cards[0].value === 15) return false;
      return true; 
    }

    return current.value > prev.value;
  }

  // Returns true if the player HAS the wished card and CAN legally play it right now
  static canSatisfyWish(hand: Card[], currentWish: number, lastTrick: Combination | null): boolean {
    const wishCards = hand.filter(c => c.value === currentWish);
    if (wishCards.length === 0) return false;

    // Fast check: If there's no previous trick, they can just lead the wished card as a single
    if (!lastTrick) return true;

    // If last trick is a single, can they beat it with the wish card?
    if (lastTrick.type === 'Single') {
      return currentWish > lastTrick.value;
    }

    // If last trick is a pair, can they make a pair with the wish card that beats it?
    if (lastTrick.type === 'Pair') {
      return wishCards.length >= 2 && currentWish > lastTrick.value;
    }

    // If last trick is a triple
    if (lastTrick.type === 'Triple') {
      return wishCards.length >= 3 && currentWish > lastTrick.value;
    }

    // For FullHouse, Straight, ConsecutivePairs:
    // This requires complex subset finding which is hard.
    // A simplified check: if they have the card but we can't easily prove they can make a valid combo,
    // we assume they might be able to. In a perfect engine we'd generate all legal plays.
    // For now, if the trick is complex, we just check if they can play a Bomb containing it.
    
    // Check if they can make a Bomb with it
    if (wishCards.length === 4) return true; // Can always play a bomb quartet (unless previous is higher bomb)
    // If we wanted to be perfectly strict, we'd calculate all possible straight flushes here too.

    // If we reach here, it's a complex trick type and we don't have a simple subset match.
    // For MVP, we will only STRICTLY enforce singles, pairs, triples, and bombs.
    // If it's a straight, we return false here meaning the game won't *force* them to play it.
    return false;
  }
}
