import { useEffect } from 'react'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'
import { useGameStore } from './store/useGameStore'
import './App.css'

function App() {
  const { gameState, connect, createRoom, joinRoom, startSoloTest, error } = useGameStore()

  useEffect(() => {
    connect()
  }, [connect])

  if (!gameState) {
    return (
      <div className="app-root">
        <Lobby 
          onCreate={(nickname, settings) => createRoom(nickname, settings)}
          onJoin={(nickname, roomId) => joinRoom(nickname, roomId)}
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
