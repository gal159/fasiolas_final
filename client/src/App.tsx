import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { Card, ClientStatePayload, TurnAction } from '../../shared/src/types'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

function playerStorageKey(roomCode: string): string {
  return `fasiolas:${roomCode}`
}

function cardLabel(card: Card | null): string {
  if (!card) {
    return '-'
  }
  return `${card.rank}${card.suit}`
}

function suitSymbol(suit: Card['suit']): string {
  if (suit === 'S') {
    return '♠'
  }
  if (suit === 'H') {
    return '♥'
  }
  if (suit === 'D') {
    return '♦'
  }
  return '♣'
}

function cardColorClass(suit: Card['suit']): string {
  if (suit === 'H' || suit === 'D') {
    return 'red'
  }
  return 'black'
}

type Seat = {
  id: string
  name: string
  cardCount: number
  topCard: Card | null
  x: number
  y: number
  isMe: boolean
}

function getRingRadiusPercent(playerCount: number): number {
  if (playerCount <= 2) {
    return 45
  }
  if (playerCount === 3) {
    return 43
  }
  if (playerCount === 4) {
    return 41
  }
  return Math.max(36, Math.min(44, 30 + playerCount * 1.8))
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [name, setName] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<ClientStatePayload | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [showTableWindow, setShowTableWindow] = useState(false)
  const [draggedCardIndex, setDraggedCardIndex] = useState<number | null>(null)

  useEffect(() => {
    const s = io(SERVER_URL)
    s.on('state_sync', (nextPayload: ClientStatePayload) => {
      setPayload(nextPayload)
      setSelectedTargetId((current) => current || nextPayload.state.players[0]?.id || '')
    })
    setSocket(s)
    return () => {
      s.disconnect()
    }
  }, [])

  const me = useMemo(
    () => payload?.state.players.find((p) => p.id === payload.yourPlayerId) ?? null,
    [payload],
  )

  const isMyTurn = payload?.state.currentTurnPlayerId === payload?.yourPlayerId
  const visibleHandIndices = useMemo<number[]>(() => {
    if (!payload) {
      return []
    }

    if (payload.state.phase !== 'DEALING') {
      return payload.yourHand.map((_, idx) => idx)
    }

    if (payload.state.pendingFasiolas) {
      return payload.yourHand.map((_, idx) => idx)
    }

    if (payload.yourHand.length === 0) {
      return []
    }

    return [payload.yourHand.length - 1]
  }, [payload])

  const showHandInCurrentPhase = visibleHandIndices.length > 0
  const canDrawFromCenterDeck = Boolean(
    payload &&
      isMyTurn &&
      payload.state.phase === 'DEALING' &&
      !payload.state.revealedDrawCard &&
      payload.state.centerDeckCount > 0,
  )

  const deckStatusText = useMemo(() => {
    if (!payload || payload.state.phase !== 'DEALING') {
      return ''
    }
    if (!isMyTurn) {
      const current = payload.state.players.find((p) => p.id === payload.state.currentTurnPlayerId)
      return `Lauk: dabar traukia ${current?.name ?? 'kitas zaidejas'}`
    }
    if (payload.state.revealedDrawCard) {
      return 'Padek atversta korta sau arba kitam'
    }
    if (payload.state.centerDeckCount <= 0) {
      return 'Kalade tuscia'
    }
    return 'Spausk kalade ir trauk korta'
  }, [payload, isMyTurn])

  useEffect(() => {
    if (payload && payload.state.phase !== 'LOBBY') {
      setShowTableWindow(true)
    }
  }, [payload?.state.phase, payload])

  const tableSeats = useMemo<Seat[]>(() => {
    if (!payload || payload.state.players.length === 0) {
      return []
    }

    const players = payload.state.players
    const total = players.length
    const meIndex = Math.max(
      players.findIndex((p) => p.id === payload.yourPlayerId),
      0,
    )
    const radius = getRingRadiusPercent(total)

    return players.map((p, absoluteIndex) => {
      const relativeIndex = (absoluteIndex - meIndex + total) % total
      const angleDeg = 90 - (360 * relativeIndex) / total
      const angleRad = (angleDeg * Math.PI) / 180
      return {
        id: p.id,
        name: p.name,
        cardCount: p.cardCount,
        topCard: p.topCard,
        x: 50 + Math.cos(angleRad) * radius,
        y: 50 + Math.sin(angleRad) * radius,
        isMe: p.id === payload.yourPlayerId,
      }
    })
  }, [payload])

  function emitAck<TReq extends Record<string, unknown>>(
    event: string,
    request: TReq,
    onOk?: (response: any) => void,
  ): void {
    if (!socket) {
      return
    }
    setError('')
    socket.emit(event, request, (response: { ok: boolean; error?: string; roomCode?: string }) => {
      if (!response?.ok) {
        setError(response?.error ?? 'Server error')
        return
      }
      onOk?.(response)
    })
  }

  function createRoom(): void {
    emitAck('create_room', { name: name || 'Player' }, (response) => {
      setRoomCode(response.roomCode as string)
      setRoomCodeInput(response.roomCode as string)
      sessionStorage.setItem(playerStorageKey(String(response.roomCode)), String(response.playerId))
    })
  }

  function joinRoom(): void {
    const normalized = roomCodeInput.trim().toUpperCase()
    if (!normalized) {
      setError('Ivesk kambario koda')
      return
    }
    const existingPlayerId = sessionStorage.getItem(playerStorageKey(normalized)) ?? undefined
    emitAck(
      'join_room',
      {
        roomCode: normalized,
        name: name || 'Player',
        existingPlayerId,
      },
      (response) => {
        setRoomCode(normalized)
        sessionStorage.setItem(playerStorageKey(normalized), String(response.playerId))
      },
    )
  }

  function sendAction(action: TurnAction): void {
    emitAck('take_turn_action', { action })
  }

  function allowDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
  }

  function handleHandCardDragStart(index: number): void {
    setDraggedCardIndex(index)
  }

  function handleHandCardDragEnd(): void {
    setDraggedCardIndex(null)
  }

  function handleSeatDrop(targetPlayerId: string): void {
    if (!payload || draggedCardIndex === null) {
      return
    }
    if (!isMyTurn) {
      setDraggedCardIndex(null)
      return
    }

    if (payload.state.phase === 'DEALING') {
      if (payload.state.revealedDrawCard) {
        sendAction({ type: 'PLACE_REVEALED', toPlayerId: targetPlayerId })
        setDraggedCardIndex(null)
        return
      }

      const topIndex = payload.yourHand.length - 1
      if (draggedCardIndex !== topIndex) {
        setError('1 dalyje galima tempti tik virsutine korta')
        setDraggedCardIndex(null)
        return
      }
      if (targetPlayerId === payload.yourPlayerId) {
        setDraggedCardIndex(null)
        return
      }

      setSelectedTargetId(targetPlayerId)
      sendAction({ type: 'MOVE_VISIBLE_CARD', toPlayerId: targetPlayerId })
      setDraggedCardIndex(null)
      return
    }

    setDraggedCardIndex(null)
  }

  function handleSeatClick(targetPlayerId: string): void {
    if (!payload || !isMyTurn) {
      return
    }
    if (payload.state.phase !== 'DEALING' || !payload.state.revealedDrawCard) {
      return
    }
    sendAction({ type: 'PLACE_REVEALED', toPlayerId: targetPlayerId })
  }

  function drawFromCenterDeck(): void {
    if (!payload) {
      return
    }
    if (!isMyTurn) {
      setError('Dabar ne tavo ejimas')
      return
    }
    if (payload.state.phase !== 'DEALING') {
      setError('Kalade spaudziama tik 1 dalyje')
      return
    }
    if (payload.state.revealedDrawCard) {
      setError('Pirmiau padek atversta korta sau arba kitam')
      return
    }
    if (payload.state.centerDeckCount <= 0) {
      setError('Kalade tuscia')
      return
    }
    sendAction({ type: 'DRAW_REVEAL' })
  }

  function handleCenterDrop(): void {
    if (!payload || draggedCardIndex === null) {
      return
    }
    if (!isMyTurn) {
      setDraggedCardIndex(null)
      return
    }
    if (payload.state.phase !== 'PLAYING') {
      setDraggedCardIndex(null)
      return
    }

    sendAction({ type: 'PLAY_CARD', cardIndex: draggedCardIndex })
    setDraggedCardIndex(null)
  }

  function renderVisualCard(card: Card, compact = false) {
    return (
      <div className={compact ? `playingCard compact ${cardColorClass(card.suit)}` : `playingCard ${cardColorClass(card.suit)}`}>
        <span className="corner top">{card.rank}{suitSymbol(card.suit)}</span>
        <span className="centerSuit">{suitSymbol(card.suit)}</span>
        <span className="corner bottom">{card.rank}{suitSymbol(card.suit)}</span>
      </div>
    )
  }

  function renderCardBack(compact = false) {
    return (
      <div className={compact ? 'cardBack compact' : 'cardBack'}>
        <span>F</span>
      </div>
    )
  }

  function startGame(): void {
    emitAck('start_game', {}, () => {
      setShowTableWindow(true)
    })
  }

  function renderDealingControls() {
    if (!payload) {
      return <></>
    }

    return (
      <div className="controls">
        <h3>1 dalis: issidalinimas</h3>
        <div className="row">
          <label htmlFor="target">Tikslas:</label>
          <select
            id="target"
            value={selectedTargetId}
            onChange={(event) => setSelectedTargetId(event.target.value)}
          >
            {payload.state.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="actions">
          <button
            disabled={!isMyTurn || !selectedTargetId}
            onClick={() => sendAction({ type: 'MOVE_VISIBLE_CARD', toPlayerId: selectedTargetId })}
          >
            Padeti virsutine korta kitam
          </button>
          <button
            disabled={!canDrawFromCenterDeck}
            onClick={drawFromCenterDeck}
          >
            Atversti korta is kalades
          </button>
          <button
            disabled={!isMyTurn || !selectedTargetId || payload.state.revealedDrawCard === null}
            onClick={() => sendAction({ type: 'PLACE_REVEALED', toPlayerId: selectedTargetId })}
          >
            Padeti atversta korta pasirinktam
          </button>
          <button
            disabled={!isMyTurn || payload.state.revealedDrawCard === null}
            onClick={() => sendAction({ type: 'PLACE_REVEALED', toPlayerId: payload.yourPlayerId })}
          >
            Padeti atversta korta sau
          </button>
          <button disabled={!isMyTurn} onClick={() => sendAction({ type: 'END_TURN' })}>
            Baigti ejima
          </button>
        </div>

        {payload.state.revealedDrawCard ? (
          <div className="revealedBox">
            <span>Atversta korta: </span>
            {renderVisualCard(payload.state.revealedDrawCard, true)}
            <span className="hint">Pasirink, kam padeti (mygtukai arba paspausk ant zaidejo vietos)</span>
          </div>
        ) : null}

        {payload.state.pendingFasiolas &&
        payload.state.pendingFasiolas.requiredFromPlayerIds.includes(payload.yourPlayerId) &&
        !payload.state.pendingFasiolas.contributedFromPlayerIds.includes(payload.yourPlayerId) ? (
          <div className="penaltyBox">
            <h4>Fasiolas aktyvus: pasirink ne virsutine korta baudai</h4>
            <div className="actions">
              {payload.yourHand
                .slice(0, Math.max(payload.yourHand.length - 1, 0))
                .map((card, idx) => (
                  <button key={`${card.rank}${card.suit}-${idx}`} onClick={() => emitAck('resolve_fasiolas', { cardIndex: idx })}>
                    {cardLabel(card)}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  function renderPlayingControls() {
    if (!payload) {
      return <></>
    }
    return (
      <div className="controls">
        <h3>2 dalis: zaidimas</h3>
        <div className="actions">
          {payload.yourHand.map((card, index) => (
            <button
              key={`${card.rank}${card.suit}-${index}`}
              disabled={!isMyTurn}
              onClick={() => sendAction({ type: 'PLAY_CARD', cardIndex: index })}
            >
              Zaisti {cardLabel(card)}
            </button>
          ))}
          <button disabled={!isMyTurn} onClick={() => sendAction({ type: 'TAKE_OLDEST' })}>
            Paimti seniausia nuo stalo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header>
        <h1>Fasiolas</h1>
        <p>Multiplayer kortu zaidimo MVP</p>
      </header>

      <section className="panel">
        <div className="row">
          <label htmlFor="name">Vardas</label>
          <input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Slapyvardis" />
        </div>
        <div className="row">
          <label htmlFor="room">Kambarys</label>
          <input
            id="room"
            value={roomCodeInput}
            onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
            placeholder="Kodas"
          />
        </div>
        <div className="actions">
          <button onClick={createRoom}>Sukurti kambari</button>
          <button onClick={joinRoom}>Prisijungti</button>
          <button disabled={!roomCode} onClick={startGame}>
            Pradeti zaidima
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
      </section>

      {showTableWindow && payload && payload.state.phase !== 'LOBBY' ? (
        <section className="tableWindowOverlay">
          <article className="tableWindow panel">
            <div className="tableWindowHeader">
              <h2>Stalo vaizdas</h2>
              <button onClick={() => setShowTableWindow(false)}>Uzdaryti</button>
            </div>
            {error ? <div className="tableInlineError">{error}</div> : null}

            <div className="roundTableArea">
              {payload.state.phase === 'DEALING' ? (
                <div className="fasiolasDock">
                  <strong>Fasiolas</strong>
                  <div className="fasiolasButtons">
                    {payload.state.players
                      .filter((p) => p.id !== payload.yourPlayerId)
                      .map((p) => (
                        <button
                          key={`dock-${p.id}`}
                          disabled={!isMyTurn}
                          onClick={() => emitAck('accuse_fasiolas', { accusedPlayerId: p.id })}
                        >
                          Skusti {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}

              <div
                className={draggedCardIndex !== null && payload.state.phase === 'PLAYING' ? 'roundTableCenter dropTarget' : 'roundTableCenter'}
                onDragOver={allowDrop}
                onDrop={handleCenterDrop}
              >
                <strong>Stalas</strong>
                <span>Faze: {payload.state.phase}</span>
                <span>Stalo kortos: {payload.state.tableStack.length}</span>
                {payload.state.phase === 'DEALING' ? (
                  <button
                    type="button"
                    className={canDrawFromCenterDeck ? 'centerDeckWrap deckClickable' : 'centerDeckWrap deckInactive'}
                    onClick={drawFromCenterDeck}
                  >
                    <div className="deckShadow">{renderCardBack()}</div>
                    <div className="deckFront">
                      {payload.state.revealedDrawCard ? (
                        <div className="deckRevealAnim" key={cardLabel(payload.state.revealedDrawCard)}>
                          {renderVisualCard(payload.state.revealedDrawCard)}
                        </div>
                      ) : (
                        renderCardBack()
                      )}
                    </div>
                    <span className="deckCount">Kalade: {payload.state.centerDeckCount}</span>
                    <span className="deckHint">{deckStatusText}</span>
                  </button>
                ) : null}
              </div>

              {tableSeats.map((seat) => (
                <div
                  key={seat.id}
                  className={
                    draggedCardIndex !== null && payload.state.phase === 'DEALING' && isMyTurn
                      ? seat.isMe
                        ? 'tableSeat me dropTarget'
                        : 'tableSeat dropTarget'
                      : seat.isMe
                        ? 'tableSeat me'
                        : 'tableSeat'
                  }
                  style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
                  onDragOver={allowDrop}
                  onDrop={() => handleSeatDrop(seat.id)}
                  onClick={() => handleSeatClick(seat.id)}
                >
                  <strong>{seat.name}</strong>
                  <span>Kortos: {seat.cardCount}</span>
                  {seat.topCard ? (
                    <div
                      draggable={
                        seat.isMe &&
                        isMyTurn &&
                        payload.state.phase === 'DEALING' &&
                        !payload.state.revealedDrawCard
                      }
                      className={
                        seat.isMe &&
                        isMyTurn &&
                        payload.state.phase === 'DEALING' &&
                        !payload.state.revealedDrawCard
                          ? 'seatTopCard draggableCard'
                          : 'seatTopCard'
                      }
                      onDragStart={() => {
                        if (!seat.isMe) {
                          return
                        }
                        const topIndex = payload.yourHand.length - 1
                        if (topIndex >= 0) {
                          handleHandCardDragStart(topIndex)
                        }
                      }}
                      onDragEnd={handleHandCardDragEnd}
                    >
                      {renderVisualCard(seat.topCard, true)}
                    </div>
                  ) : (
                    <span>Virsus: -</span>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {payload ? (
        <>
          <section className="panel status">
            <div>Kambarys: {payload.state.roomCode}</div>
            <div>Faze: {payload.state.phase}</div>
            <div>Tavo id: {payload.yourPlayerId.slice(0, 8)}</div>
            <div>Eile: {payload.state.currentTurnPlayerId?.slice(0, 8) ?? '-'}</div>
            <div>Kozeris: {payload.state.trumpSuit ?? 'none'}</div>
            <div>Kalades viduryje: {payload.state.centerDeckCount}</div>
          </section>

          <section className="panel">
            <h2>Zaidejai</h2>
            <div className="players">
              {payload.state.players.map((p) => (
                <article key={p.id} className={p.id === payload.yourPlayerId ? 'player me' : 'player'}>
                  <strong>{p.name}</strong>
                  <span>ID: {p.id.slice(0, 8)}</span>
                  <span>Kortos: {p.cardCount}</span>
                  <span>Virsus: {cardLabel(p.topCard)}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Stalas</h2>
            <div className="stack">
              {payload.state.tableStack.map((c, i) => (
                <div key={`${c.rank}${c.suit}-${i}`}>{renderVisualCard(c, true)}</div>
              ))}
            </div>
            <h3>Tavo kortos</h3>
            {showHandInCurrentPhase ? (
              <div className="stack">
                {visibleHandIndices.map((i) => {
                  const c = payload.yourHand[i]
                  const canDrag =
                    isMyTurn &&
                    (payload.state.phase === 'PLAYING' ||
                      (payload.state.phase === 'DEALING' && i === payload.yourHand.length - 1))
                  return (
                    <div
                      key={`${c.rank}${c.suit}-${i}`}
                      draggable={canDrag}
                      className={canDrag ? 'draggableCard' : 'draggableCard disabled'}
                      onDragStart={() => handleHandCardDragStart(i)}
                      onDragEnd={handleHandCardDragEnd}
                    >
                      {renderVisualCard(c)}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="phaseHint">1 dalyje rankos kortos slepiamos.</p>
            )}
          </section>

          {payload.state.phase === 'DEALING' ? renderDealingControls() : null}
          {payload.state.phase === 'PLAYING' ? renderPlayingControls() : null}

          <section className="panel">
            <h2>Zurnalas</h2>
            <ul className="log">
              {payload.state.dealerLog.map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {me && payload?.state.phase === 'FINISHED' ? (
        <section className="panel finish">
          {payload.state.loserPlayerId === me.id ? <h2>Pralaimejai</h2> : <h2>Laimetojas be pralaimejimo</h2>}
        </section>
      ) : null}
    </div>
  )
}

export default App
