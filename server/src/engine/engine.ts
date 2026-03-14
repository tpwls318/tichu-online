import { GameState, Player, Card, GamePhase } from '../types/game.js';
import { TichuDeck } from './deck.js';
import { HandValidator, Combination } from './validator.js';

export class TichuEngine {
  state: GameState;
  deck: TichuDeck;
  private remainingHands: { [playerId: string]: Card[] } = {};
  private grandTichuResponses: { [playerId: string]: boolean } = {};
  private passCount: number = 0;
  private finishedPlayers: string[] = [];

  constructor(roomId: string, settings?: { targetScore: number; timeLimit: number }) {
    this.deck = new TichuDeck();
    this.state = {
      roomId,
      players: [],
      phase: 'WAITING',
      currentTurn: 0,
      currentTrickCards: [],
      lastTrick: null,
      scores: { teamA: 0, teamB: 0 },
      passStates: {},
      receivedPasses: {},
      cardEvent: null,
      currentWish: null,
      history: [],
      roundHistory: [],
      settings: settings || { targetScore: 1000, timeLimit: 30 }
    };
  }
  
  addPlayer(id: string, nickname: string) {
    if (this.state.players.length >= 4) return false;
    
    const team = this.state.players.length % 2 === 0 ? 'A' : 'B';
    const player: Player = {
      id,
      nickname,
      hand: [],
      collectedCards: [],
      tichuState: null,
      isReady: false,
      team,
      seat: this.state.players.length
    };
    
    this.state.players.push(player);
    return true;
  }

  removePlayer(id: string) {
    const playerIndex = this.state.players.findIndex(p => p.id === id);
    if (playerIndex !== -1) {
      this.state.players.splice(playerIndex, 1);
      
      // Reassign seats to remaining players
      this.state.players.forEach((p, index) => {
        p.seat = index;
      });
      
      // If the game was running and someone leaves, we might need to reset to WAITING
      // but for now we'll just return to waiting room unconditionally if we lose a player
      if (this.state.phase !== 'WAITING') {
        this.returnToWaitingRoom();
      }
    }
    return this.state.players.length;
  }

  startGame() {
    if (this.state.players.length < 4) return false;
    
    this.deck.reset();
    this.deck.shuffle();
    const { hands8, hands6 } = this.deck.deal();
    
    this.state.players.forEach((player, i) => {
      player.hand = hands8[i] || [];
      player.collectedCards = [];
      player.tichuState = null;
      this.remainingHands[player.id] = hands6[i] || [];
      this.state.passStates[player.id] = {};
    });
    
    this.state.phase = 'GRAND_TICHU';
    this.grandTichuResponses = {};
    return true;
  }

  startNewRound() {
    // 점수와 설정은 유지하고 나머지 초기화
    this.deck.reset();
    this.deck.shuffle();
    const { hands8, hands6 } = this.deck.deal();

    this.state.players.forEach((player, i) => {
      player.hand = hands8[i] || [];
      player.collectedCards = [];
      player.tichuState = null;
      this.remainingHands[player.id] = hands6[i] || [];
      this.state.passStates[player.id] = {};
    });

    this.state.phase = 'GRAND_TICHU';
    this.state.lastTrick = null;
    this.state.currentTrickCards = [];
    this.state.currentTurn = 0;
    this.state.currentWish = null;
    this.state.cardEvent = null;
    this.state.roundResult = null;
    this.state.receivedPasses = {};
    this.grandTichuResponses = {};
    this.passCount = 0;
    this.finishedPlayers = [];

    return true;
  }

  toggleReady(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (player) {
      player.isReady = !player.isReady;
    }
  }

  returnToWaitingRoom() {
    this.state.phase = 'WAITING';
    this.state.scores = { teamA: 0, teamB: 0 };
    this.state.history = [];
    this.state.roundHistory = [];
    this.state.currentTrickCards = [];
    this.state.lastTrick = null;
    this.state.cardEvent = null;
    this.state.currentWish = null;
    this.state.roundResult = null;
    this.state.passStates = {};
    this.state.receivedPasses = {};
    this.passCount = 0;
    this.finishedPlayers = [];
    this.grandTichuResponses = {};
    this.remainingHands = {};
    
    this.state.players.forEach(p => {
      p.hand = [];
      p.collectedCards = [];
      p.tichuState = null;
      p.isReady = false;
    });
  }

  answerGrandTichu(playerId: string, callGrand: boolean) {
    if (this.state.phase !== 'GRAND_TICHU') return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    player.tichuState = callGrand ? 'GRAND' : 'NONE';
    this.grandTichuResponses[playerId] = true;

    // Deal remaining 6 cards immediately to this player
    player.hand.push(...(this.remainingHands[playerId] || []));
    delete this.remainingHands[playerId]; // clear to avoid duplicates if called again accidentally

    // Check if all 4 answered
    if (Object.keys(this.grandTichuResponses).length === 4) {
      // Move to PASSING
      this.state.phase = 'PASSING';
    }
    
    return true;
  }

  passCards(playerId: string, targetMap: { [targetId: string]: string }) {
    if (this.state.phase !== 'PASSING') return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    for (const [targetId, cardId] of Object.entries(targetMap)) {
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) continue;
      
      const card = player.hand[cardIndex]!;
      this.state.passStates[playerId]![targetId] = card;
    }

    // Check if all players have passed 3 cards
    const allPassed = this.state.players.every(p => 
      Object.keys(this.state.passStates[p.id] || {}).length === 3
    );

    if (allPassed) {
      this.completePassing();
    }
    
    return true;
  }

  private completePassing() {
    this.state.receivedPasses = {};
    
    this.state.players.forEach(player => {
      this.state.receivedPasses![player.id] = {};
      
      // 1. Remove cards passed FROM this player
      const passedFromSelf = Object.values(this.state.passStates[player.id] || {});
      player.hand = player.hand.filter(c => !passedFromSelf.find(pc => pc.id === c.id));

      // 2. Add cards passed TO this player
      this.state.players.forEach(other => {
        const cardToSelf = this.state.passStates[other.id]?.[player.id];
        if (cardToSelf) {
          player.hand.push(cardToSelf);
          this.state.receivedPasses![player.id][other.id] = cardToSelf;
        }
      });
    });

    this.state.phase = 'PLAYING';
    this.state.passStates = {};
    
    // Find player with sparrow to start
    const sparrowPlayer = this.state.players.find(p => p.hand.find(c => c.id === 'Sparrow'));
    if (sparrowPlayer) {
      this.state.currentTurn = sparrowPlayer.seat;
    }
  }

  playCards(playerId: string, cardIds: string[], wishValue?: number) {
    if (this.state.phase !== 'PLAYING') return false;
    if (this.state.cardEvent?.type === 'DragonGiveaway') return false; // Block actions until dragon giveaway is resolved
    
    // Clear any previous events
    this.state.cardEvent = null;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    // Find cards in hand
    const cardsToPlay = cardIds.map(id => player.hand.find(c => c.id === id)).filter((c): c is Card => !!c);
    if (cardsToPlay.length !== cardIds.length) return false; // some cards not found

    const combo = HandValidator.validate(cardsToPlay);
    if (combo.type === 'Invalid') return false;

    // Turn check: Normal play requires turn, otherwise MUST be a bomb played on an active trick
    if (player.seat !== this.state.currentTurn) {
      if (!combo.type.startsWith('Bomb')) return false;
      if (!this.state.lastTrick) return false; // Cannot bomb an empty table out of turn
    }

    // Dog can ONLY be played if leading the trick
    if (combo.type === 'Dog' && this.state.lastTrick !== null) return false;

    let prevCombo: Combination | null = null;
    // Compare with last trick if exists
    if (this.state.lastTrick && this.state.lastTrick.playerId !== playerId) {
      // Create a dummy previous combination structure to compare
      prevCombo = {
        type: this.state.lastTrick.type as any,
        value: this.state.lastTrick.value,
        length: this.state.lastTrick.cards.length,
        cards: this.state.lastTrick.cards
      };
      
      if (!HandValidator.compare(prevCombo, combo)) return false;
    }

    // Wish Enforcement Strategy (Sparrow)
    if (this.state.currentWish !== null) {
      const satisfiesWish = combo.cards.some(c => c.value === this.state.currentWish);
      if (!satisfiesWish) {
        // Did they have the ability to satisfy it?
        if (HandValidator.canSatisfyWish(player.hand, this.state.currentWish, prevCombo)) {
          return false; // Illegal play, they are holding out on the wish
        }
      }
    }

    // Success: Remove cards from hand
    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    
    // Check if player went out
    if (player.hand.length === 0 && !this.finishedPlayers.includes(player.id)) {
      this.finishedPlayers.push(player.id);
    }

    // Handle Sparrow wish logic 
    const hasSparrow = combo.cards.some(c => c.value === 1);
    if (hasSparrow && wishValue !== undefined && wishValue >= 2 && wishValue <= 14) {
      this.state.currentWish = wishValue;
    }
    
    // Clear wish if the required value was played
    if (this.state.currentWish !== null && combo.cards.some(c => c.value === this.state.currentWish)) {
      this.state.currentWish = null;
    }

    if (combo.type === 'Dog') {
      // Dog Logic: Pass the turn to partner immediately
      const partner = this.state.players.find(p => p.team === player.team && p.id !== player.id);
      
      let nextTurnSeat = (player.seat + 1) % 4; // default to next if partner is out
      if (partner && partner.hand.length > 0) {
        nextTurnSeat = partner.seat;
      } else {
        // If partner is out, pass to next active player
        let t = (player.seat + 1) % 4;
        let pLoops = 4;
        while (pLoops > 0) {
          const nextP = this.state.players.find(x => x.seat === t);
          if (nextP && nextP.hand.length > 0) {
            nextTurnSeat = t;
            break;
          }
          t = (t + 1) % 4;
          pLoops--;
        }
      }

      this.state.currentTurn = nextTurnSeat;
      this.state.cardEvent = {
        type: 'Dog',
        targetSeat: nextTurnSeat,
        duration: 2500
      };
      
      this.state.lastTrick = null; // Dog starts a fresh trick for the partner
      this.passCount = 0;
      
      return true; // Return immediately, trick isn't saved, it just passes lead basically
    }

    // Normal play: Update trick
    let trickValue = combo.value;
    if (combo.type === 'Single' && combo.cards[0].value === 16 && this.state.lastTrick) {
      trickValue = this.state.lastTrick.value + 0.5;
    }

    this.state.currentTrickCards.push(...cardsToPlay);

    this.state.lastTrick = {
      cards: cardsToPlay,
      playerId,
      type: combo.type,
      value: trickValue,
    };
    
    // Reset pass count
    this.passCount = 0;

    // Force current turn to bomber before advancing, to ensure next player is relative to bomber
    this.state.currentTurn = player.seat;

    if (this.checkRoundEnd()) return true;

    this.advanceTurn();
    return true;
  }

  passTrick(playerId: string) {
    if (this.state.phase !== 'PLAYING') return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seat !== this.state.currentTurn) return false;
    
    // Cannot pass if you are leading the trick
    if (!this.state.lastTrick || this.state.lastTrick.playerId === playerId) return false;

    // Wish Enforcement: Cannot pass if you can satisfy the wish
    if (this.state.currentWish !== null) {
      const prevCombo: Combination = {
        type: this.state.lastTrick.type as any,
        value: this.state.lastTrick.value,
        length: this.state.lastTrick.cards.length,
        cards: this.state.lastTrick.cards,
      };
      if (HandValidator.canSatisfyWish(player.hand, this.state.currentWish, prevCombo)) {
        return false; // Illegal pass, must play the wished card
      }
    }

    this.passCount++;
    this.advanceTurn();
    
    const activePlayers = this.state.players.filter(p => p.hand.length > 0).length;
    const trickWinner = this.state.players.find(p => p.id === this.state.lastTrick!.playerId);
    const trickWinnerActive = trickWinner && trickWinner.hand.length > 0;
    const passesNeeded = trickWinnerActive ? activePlayers - 1 : activePlayers;

    // If enough people passed, the trick is won by the last person who played
    if (this.passCount >= passesNeeded) {
      const winnerId = this.state.lastTrick!.playerId;
      const winner = this.state.players.find(p => p.id === winnerId);
      
      const isDragonTrick = this.state.lastTrick!.cards.some(c => c.value === 15);
      if (isDragonTrick && winner) {
        this.state.cardEvent = {
          type: 'DragonGiveaway',
          targetSeat: winner.seat,
          duration: 0 // Waiting for user input
        };
        this.state.currentTurn = winner.seat; // Focus on winner
        // Keep currentTrickCards intact for giveDragonTrick to use
        return true;
      }

      // Trick is won. Collect cards!
      if (winner) {
        winner.collectedCards.push(...this.state.currentTrickCards);
      }
      this.state.currentTrickCards = [];

      this.state.lastTrick = null;
      this.passCount = 0;
      
      if (winner && winner.hand.length === 0) {
        // If winner is out, pass lead to the next active player counter-clockwise
        let t = (winner.seat + 3) % 4;
        let pLoops = 4;
        while (pLoops > 0) {
          const nextP = this.state.players.find(x => x.seat === t);
          if (nextP && nextP.hand.length > 0) {
            this.state.currentTurn = t;
            break;
          }
          t = (t + 3) % 4;
          pLoops--;
        }
      } else if (winner) {
        this.state.currentTurn = winner.seat;
      }
    }

    if (this.checkRoundEnd()) return true;

    return true;
  }

  private advanceTurn() {
    // Clear UI events unless it's a persistent prompt or a timed animation
    if (this.state.cardEvent?.type !== 'DragonGiveaway' && 
        this.state.cardEvent?.type !== 'DragonReceived' && 
        this.state.cardEvent?.type !== 'Dog') {
      this.state.cardEvent = null;
    }

    // Counter-clockwise turn advancement
    let nextTurn = (this.state.currentTurn + 3) % 4;
    // Skip players who are out of cards
    let maxLoops = 4;
    while (maxLoops > 0) {
      const p = this.state.players.find(p => p.seat === nextTurn);
      if (p && p.hand.length > 0) {
        this.state.currentTurn = nextTurn;
        return;
      }
      nextTurn = (nextTurn + 3) % 4;
      maxLoops--;
    }
  }

  giveDragonTrick(playerId: string, targetId: string) {
    if (this.state.phase !== 'PLAYING') return false;
    if (this.state.cardEvent?.type !== 'DragonGiveaway') return false;

    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.seat !== this.state.cardEvent.targetSeat) return false;

    const target = this.state.players.find(p => p.id === targetId);
    if (!target) return false;
    
    // Target must be an opponent
    if (target.team === player.team) return false;

    // Everything is valid, assign the trick to the target
    target.collectedCards.push(...this.state.currentTrickCards);
    this.state.currentTrickCards = [];

    this.state.lastTrick = null;
    this.passCount = 0;
    this.state.cardEvent = {
      type: 'DragonReceived',
      duration: 3000,
      fromSeat: player.seat,
      targetSeat: target.seat
    };

    // Restore turn to the winner (or next active if out)
    if (player.hand.length === 0) {
      let t = (player.seat + 1) % 4;
      let pLoops = 4;
      while (pLoops > 0) {
        const nextP = this.state.players.find(x => x.seat === t);
        if (nextP && nextP.hand.length > 0) {
          this.state.currentTurn = t;
          break;
        }
        t = (t + 1) % 4;
        pLoops--;
      }
    } else {
      this.state.currentTurn = player.seat;
    }

    if (this.checkRoundEnd()) return true;

    return true;
  }

  private checkRoundEnd(): boolean {
    const prevScoreA = this.state.scores.teamA;
    const prevScoreB = this.state.scores.teamB;

    if (this.finishedPlayers.length >= 2) {
      const first = this.state.players.find(p => p.id === this.finishedPlayers[0]);
      const second = this.state.players.find(p => p.id === this.finishedPlayers[1]);
      
      // 1-2 Victory
      if (this.finishedPlayers.length === 2 && first && second && first.team === second.team) {
        this.state.phase = 'FINISHED';
        this.state.cardEvent = { type: 'OneTwoVictory', targetSeat: first.seat, duration: 5000 };
        // Basic 200 point score adjustment for 1-2 win
        if (first.team === 'A') {
          this.state.scores.teamA += 200;
        } else {
          this.state.scores.teamB += 200;
        }

        // Evaluate Tichu Calls
        this.state.players.forEach(p => {
          if (p.tichuState === 'GRAND') {
            if (p.id === first.id) {
              if (p.team === 'A') this.state.scores.teamA += 200;
              else this.state.scores.teamB += 200;
            } else {
              if (p.team === 'A') this.state.scores.teamA -= 200;
              else this.state.scores.teamB -= 200;
            }
          } else if (p.tichuState === 'SMALL') {
            if (p.id === first.id) {
              if (p.team === 'A') this.state.scores.teamA += 100;
              else this.state.scores.teamB += 100;
            } else {
              if (p.team === 'A') this.state.scores.teamA -= 100;
              else this.state.scores.teamB -= 100;
            }
          }
        });

        const deltaA = this.state.scores.teamA - prevScoreA;
        const deltaB = this.state.scores.teamB - prevScoreB;
        this.state.roundHistory.push({ teamA: deltaA, teamB: deltaB });

        this.state.roundResult = {
          teamADelta: deltaA,
          teamBDelta: deltaB,
          teamATotal: this.state.scores.teamA,
          teamBTotal: this.state.scores.teamB,
          message: `${first.team}팀 1-2 승리!`
        };

        return true;
      }
    }

    if (this.finishedPlayers.length >= 3) {
      // Normal End
      this.state.phase = 'FINISHED';
      
      const lastPlayerId = this.state.players.find(p => !this.finishedPlayers.includes(p.id))?.id;
      const firstPlayerId = this.finishedPlayers[0];
      
      if (lastPlayerId && firstPlayerId) {
        const lastPlayer = this.state.players.find(p => p.id === lastPlayerId);
        const firstPlayer = this.state.players.find(p => p.id === firstPlayerId);
        
        if (lastPlayer && firstPlayer) {
          // 4th place penalty 1: Give last player's unplayed hand to the opposing team
          const opposingTeam = lastPlayer.team === 'A' ? 'B' : 'A';
          const opponent = this.state.players.find(p => p.team === opposingTeam);
          if (opponent) {
            opponent.collectedCards.push(...lastPlayer.hand);
          }
          lastPlayer.hand = []; // Clear hand so standard end triggers cleanly
          
          // 4th place penalty 2: Give last player's collected tricks to first player
          firstPlayer.collectedCards.push(...lastPlayer.collectedCards);
          lastPlayer.collectedCards = [];
        }
      }

      // Calculate final points from collected cards
      let teamAPoints = 0;
      let teamBPoints = 0;

      this.state.players.forEach(p => {
        let points = 0;
        p.collectedCards.forEach(c => {
          if (c.value === 5) points += 5;
          else if (c.value === 10 || c.value === 13) points += 10;
          else if (c.value === 15) points += 25; // Dragon
          else if (c.value === 16) points -= 25; // Phoenix
        });
        
        if (p.team === 'A') teamAPoints += points;
        else teamBPoints += points;
      });

      this.state.scores.teamA += teamAPoints;
      this.state.scores.teamB += teamBPoints;

      // Evaluate Tichu Calls
      this.state.players.forEach(p => {
        if (p.tichuState === 'GRAND') {
          if (p.id === firstPlayerId) {
            if (p.team === 'A') this.state.scores.teamA += 200;
            else this.state.scores.teamB += 200;
          } else {
            if (p.team === 'A') this.state.scores.teamA -= 200;
            else this.state.scores.teamB -= 200;
          }
        } else if (p.tichuState === 'SMALL') {
          if (p.id === firstPlayerId) {
            if (p.team === 'A') this.state.scores.teamA += 100;
            else this.state.scores.teamB += 100;
          } else {
            if (p.team === 'A') this.state.scores.teamA -= 100;
            else this.state.scores.teamB -= 100;
          }
        }
      });

      this.state.cardEvent = { type: 'RoundEnd', targetSeat: 0, duration: 5000 };

      const deltaA = this.state.scores.teamA - prevScoreA;
      const deltaB = this.state.scores.teamB - prevScoreB;
      this.state.roundHistory.push({ teamA: deltaA, teamB: deltaB });

      this.state.roundResult = {
        teamADelta: deltaA,
        teamBDelta: deltaB,
        teamATotal: this.state.scores.teamA,
        teamBTotal: this.state.scores.teamB,
        message: '라운드 종료'
      };

      return true;
    }

    return false;
  }
}
