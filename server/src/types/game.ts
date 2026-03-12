export type Suit = 'Jade' | 'Sword' | 'Pagoda' | 'Star' | 'Special';

export interface Card {
  suit: Suit;
  value: number; // 2-14 (A), or special: 1 (Sparrow), 0 (Dog), 15 (Dragon), 16 (Phoenix)
  id: string;
}

export type GamePhase = 'WAITING' | 'GRAND_TICHU' | 'PASSING' | 'PLAYING' | 'FINISHED';

export interface Player {
  id: string;
  nickname: string;
  hand: Card[];
  collectedCards: Card[];
  tichuState: 'GRAND' | 'SMALL' | 'NONE' | null;
  isReady: boolean;
  team: 'A' | 'B';
  seat: number; // 0, 1, 2, 3 (clockwise)
}

export interface GameState {
  roomId: string;
  players: Player[];
  phase: GamePhase;
  currentTurn: number;
  currentTrickCards: Card[];
  lastTrick: {
    cards: Card[];
    playerId: string;
    type: string;
    value: number;
  } | null;
  scores: { teamA: number; teamB: number };
  passStates: { [playerId: string]: { [targetPlayerId: string]: Card } }; 
  receivedPasses?: { [playerId: string]: { [fromPlayerId: string]: Card } }; // UI delay tracking
  cardEvent?: { type: string; targetSeat: number; duration: number; fromSeat?: number } | null;
  currentWish: number | null;
  history: any[];
}
