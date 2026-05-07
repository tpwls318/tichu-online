import { useEffect } from 'react'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'
import { useGameStore } from './store/useGameStore'
import './App.css'

function App() {
  const { socket, gameState, connect, createRoom, joinRoom, startSoloTest, error } = useGameStore()

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    if (socket && !gameState) {
      const urlParams = new URLSearchParams(window.location.search);
      const inviteRoomId = urlParams.get('roomId');
      if (inviteRoomId) {
        const tempNickname = `Guest_${Math.floor(Math.random() * 10000)}`;
        localStorage.setItem('tichu_needs_nickname', 'true');
        joinRoom(tempNickname, inviteRoomId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]); // Run only when socket becomes available

  if (!gameState) {
    return (
      <div className="app-root">
        <Lobby 
          onCreate={(nickname, settings) => {
            localStorage.setItem('tichu_nickname', nickname);
            createRoom(nickname, settings);
          }}
          onJoin={(nickname, roomId) => {
            localStorage.setItem('tichu_nickname', nickname);
            joinRoom(nickname, roomId);
          }}
          onSoloTest={(nickname, settings) => startSoloTest(nickname, settings)}
        />
        {error && <div className="error-toast">{error}</div>}
      </div>
    )
  }

  return (
    <div className="app-root">
      <GameBoard />
      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}

export default App
