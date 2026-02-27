import { Card, Suit } from '../types/game.js';

export class TichuDeck {
  cards: Card[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    const suits: Suit[] = ['Jade', 'Sword', 'Pagoda', 'Star'];
    this.cards = [];

    // Normal cards 2-A
    for (const suit of suits) {
      for (let value = 2; value <= 14; value++) {
        this.cards.push({
          suit,
          value,
          id: `${suit}-${value}`
        });
      }
    }

    // Special cards
    this.cards.push({ suit: 'Special', value: 1, id: 'Sparrow' });
    this.cards.push({ suit: 'Special', value: 0, id: 'Dog' });
    this.cards.push({ suit: 'Special', value: 15, id: 'Dragon' });
    this.cards.push({ suit: 'Special', value: 16, id: 'Phoenix' });
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal() {
    const hands8: Card[][] = [[], [], [], []];
    const hands6: Card[][] = [[], [], [], []];
    
    let cardIdx = 0;
    while(cardIdx < 32) {
      hands8[cardIdx % 4]!.push(this.cards[cardIdx]!);
      cardIdx++;
    }
    while(cardIdx < 56) {
      hands6[cardIdx % 4]!.push(this.cards[cardIdx]!);
      cardIdx++;
    }
    
    return { hands8, hands6 };
  }
}
