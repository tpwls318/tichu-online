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
    
    const sorted = [...cards].sort((a, b) => a.value - b.value);

    // Single
    if (cards.length === 1) {
      const card = cards[0]!;
      if (card.value === 0) return { type: 'Dog', value: 0, length: 1, cards };
      return { type: 'Single', value: card.value, length: 1, cards };
    }

    // Pair
    if (cards.length === 2 && sorted[0]?.value === sorted[1]?.value) {
      return { type: 'Pair', value: sorted[0]!.value, length: 2, cards };
    }

    // Triple
    if (cards.length === 3 && 
        sorted[0]?.value === sorted[1]?.value && 
        sorted[1]?.value === sorted[2]?.value) {
      return { type: 'Triple', value: sorted[0]!.value, length: 3, cards };
    }

    // Full House (3 + 2)
    if (cards.length === 5) {
      if (sorted[0]?.value === sorted[1]?.value && sorted[1]?.value === sorted[2]?.value && sorted[3]?.value === sorted[4]?.value) {
        return { type: 'FullHouse', value: sorted[0]!.value, length: 5, cards };
      }
      if (sorted[0]?.value === sorted[1]?.value && sorted[2]?.value === sorted[3]?.value && sorted[3]?.value === sorted[4]?.value) {
        return { type: 'FullHouse', value: sorted[2]!.value, length: 5, cards };
      }
    }

    // Straight (5+ cards)
    if (cards.length >= 5) {
      let isStraight = true;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.value !== sorted[i - 1]!.value + 1) {
          isStraight = false;
          break;
        }
      }
      if (isStraight) {
        return { type: 'Straight', value: sorted[sorted.length - 1]!.value, length: cards.length, cards };
      }
    }

    // Consecutive Pairs (2+ pairs)
    if (cards.length >= 4 && cards.length % 2 === 0) {
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
        return { type: 'ConsecutivePairs', value: sorted[sorted.length - 1]!.value, length: cards.length, cards };
      }
    }

    return { type: 'Invalid', value: 0, length: 0, cards };
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

    return current.value > prev.value;
  }
}
