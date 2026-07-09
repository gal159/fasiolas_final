import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  AVATAR_RARITY,
  AVATAR_OPTIONS,
  EFFECT_RARITY,
  EFFECT_OPTIONS,
  HAT_OPTIONS,
  HAT_RARITY,
  PROFILE_COLOR_OPTIONS,
  PROFILE_SLOT_OPTIONS,
  RARITY_PRICES,
  SKIN_RARITY,
  SKIN_OPTIONS,
  type Card,
  type ClientStatePayload,
  type PlayerAccountState,
  type PlayerProfile,
  type RarityId,
  type ShopCatalogItem,
  type ShopItemType,
  type TurnAction,
} from '../../shared/src/types'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const PROFILE_SLOTS_STORAGE_KEY = 'fasiolas:profile-slots'
const LOGIN_SESSION_STORAGE_KEY = 'fasiolas:logged-in'
const REGISTERED_USERS_STORAGE_KEY = 'fasiolas:registered-users'

const AVATAR_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Dzeusas',
  wizard: 'Burtininkas',
  pablo: 'Pablo',
}

const HAT_LABELS: Record<PlayerProfile['hatId'], string> = {
  none: 'Be kepures',
  cowboy: 'Kaubojus',
  horns: 'Ragai',
  visor: 'Salmelis',
  winter: 'Ziemos kepure',
  antenna: 'Antenos',
}

const SKIN_LABELS: Record<PlayerProfile['skinId'], string> = {
  default: 'Numatytas',
  striped: 'Dryzuotas',
  chrome: 'Chromas',
  neon: 'Neonas',
  carbon: 'Karbonas',
  frost: 'Serkas',
}

const EFFECT_LABELS: Record<PlayerProfile['effectId'], string> = {
  none: 'Be efekto',
  outline: 'Konturas',
  glow: 'Svytejimas',
  fire: 'Ugnis',
  shadow: 'Seselis',
  trail: 'Sleifas',
}

const EFFECT_TIER_LABELS: Record<PlayerProfile['effectId'], string> = {
  none: 'Common',
  trail: 'Uncommon',
  outline: 'Rare',
  glow: 'Epic',
  shadow: 'Legendary',
  fire: 'Mythic',
}

const EFFECT_GAMES_REQUIRED: Record<PlayerProfile['effectId'], number> = {
  none: 8,
  trail: 28,
  outline: 55,
  glow: 110,
  shadow: 180,
  fire: 260,
}

const AVATAR_ELEMENT_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Sky',
  wizard: 'Arcane',
  pablo: 'Chaos',
}

const AVATAR_THEME_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Thunder Empire',
  wizard: 'Mystic Coven',
  pablo: 'Golden Syndicate',
}

const RARITY_LABELS: Record<RarityId, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
}

const SHOP_SECTION_ORDER: ShopItemType[] = ['effect', 'skin', 'hat', 'avatar']

const SHOP_SECTION_LABELS: Record<ShopItemType, string> = {
  effect: 'Effects',
  skin: 'Skins',
  hat: 'Hats',
  avatar: 'Avatars',
}

const SHOP_ITEM_LABELS: Record<ShopItemType, Record<string, string>> = {
  effect: EFFECT_LABELS,
  skin: SKIN_LABELS,
  hat: HAT_LABELS,
  avatar: AVATAR_LABELS,
}

function createEmptyAccount(): PlayerAccountState {
  return {
    points: 0,
    gamesPlayed: 0,
    unlocked: {
      avatars: AVATAR_OPTIONS.filter((id) => AVATAR_RARITY[id] === 'common'),
      hats: HAT_OPTIONS.filter((id) => HAT_RARITY[id] === 'common'),
      skins: SKIN_OPTIONS.filter((id) => SKIN_RARITY[id] === 'common'),
      effects: EFFECT_OPTIONS.filter((id) => EFFECT_RARITY[id] === 'common'),
    },
  }
}

type ProfileSlotMap = Record<PlayerProfile['profileSlot'], PlayerProfile>

function playerStorageKey(roomCode: string): string {
  return `fasiolas:${roomCode}`
}

function hexToRgba(hex: string, alpha: number): string {
  const source = hex.replace('#', '')
  const normalized = source.length === 3
    ? source
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
    : source

  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function createDefaultProfile(slot: PlayerProfile['profileSlot'] = PROFILE_SLOT_OPTIONS[0]): PlayerProfile {
  const slotIndex = PROFILE_SLOT_OPTIONS.findIndex((item) => item === slot)
  const normalizedIndex = Math.max(0, slotIndex)
  return {
    baseColor: PROFILE_COLOR_OPTIONS[normalizedIndex % PROFILE_COLOR_OPTIONS.length],
    avatarId: 'zeus',
    hatId: 'none',
    skinId: 'default',
    effectId: 'none',
    profileSlot: slot,
  }
}

function createDefaultProfileSlots(): ProfileSlotMap {
  return {
    A: createDefaultProfile('A'),
    B: createDefaultProfile('B'),
    C: createDefaultProfile('C'),
  }
}

function withSlot(profile: PlayerProfile, slot: PlayerProfile['profileSlot']): PlayerProfile {
  return { ...profile, profileSlot: slot }
}

function slotToRoman(slot: PlayerProfile['profileSlot']): string {
  if (slot === 'A') {
    return 'I'
  }
  if (slot === 'B') {
    return 'II'
  }
  return 'III'
}

function getProfilePower(profile: PlayerProfile): number {
  const avatarIndex = AVATAR_OPTIONS.findIndex((item) => item === profile.avatarId)
  const hatIndex = HAT_OPTIONS.findIndex((item) => item === profile.hatId)
  const skinIndex = SKIN_OPTIONS.findIndex((item) => item === profile.skinId)
  const effectIndex = EFFECT_OPTIONS.findIndex((item) => item === profile.effectId)
  const slotIndex = PROFILE_SLOT_OPTIONS.findIndex((item) => item === profile.profileSlot)
  const score =
    2600 +
    (avatarIndex + 1) * 780 +
    (hatIndex + 1) * 180 +
    (skinIndex + 1) * 135 +
    (effectIndex + 1) * 320 +
    (slotIndex + 1) * 210
  return Math.min(9900, Math.max(2200, score))
}

function isPlayerProfile(value: unknown): value is PlayerProfile {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.baseColor === 'string' &&
    PROFILE_COLOR_OPTIONS.includes(record.baseColor as PlayerProfile['baseColor']) &&
    typeof record.avatarId === 'string' &&
    AVATAR_OPTIONS.includes(record.avatarId as PlayerProfile['avatarId']) &&
    typeof record.hatId === 'string' &&
    HAT_OPTIONS.includes(record.hatId as PlayerProfile['hatId']) &&
    typeof record.skinId === 'string' &&
    SKIN_OPTIONS.includes(record.skinId as PlayerProfile['skinId']) &&
    typeof record.effectId === 'string' &&
    EFFECT_OPTIONS.includes(record.effectId as PlayerProfile['effectId']) &&
    typeof record.profileSlot === 'string' &&
    PROFILE_SLOT_OPTIONS.includes(record.profileSlot as PlayerProfile['profileSlot'])
  )
}

function loadStoredProfileSlots(): ProfileSlotMap {
  const fallback = createDefaultProfileSlots()
  const raw = sessionStorage.getItem(PROFILE_SLOTS_STORAGE_KEY)
  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const resolved: ProfileSlotMap = { ...fallback }

    for (const slot of PROFILE_SLOT_OPTIONS) {
      const candidate = parsed[slot]
      if (isPlayerProfile(candidate)) {
        resolved[slot] = withSlot(candidate, slot)
      }
    }

    return resolved
  } catch {
    return fallback
  }
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

type PlayingHandSortMode = 'suit' | 'rank'

type PlayingHandEntry = {
  card: Card
  index: number
}

const SUIT_SORT_ORDER: Record<Card['suit'], number> = {
  C: 0,
  D: 1,
  H: 2,
  S: 3,
}

const RANK_SORT_ORDER: Record<Card['rank'], number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  '10': 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
}

function sortPlayingHandEntries(entries: PlayingHandEntry[], mode: PlayingHandSortMode): PlayingHandEntry[] {
  return [...entries].sort((left, right) => {
    if (mode === 'suit') {
      const bySuit = SUIT_SORT_ORDER[left.card.suit] - SUIT_SORT_ORDER[right.card.suit]
      if (bySuit !== 0) {
        return bySuit
      }
      const byRank = RANK_SORT_ORDER[left.card.rank] - RANK_SORT_ORDER[right.card.rank]
      if (byRank !== 0) {
        return byRank
      }
      return left.index - right.index
    }

    const byRank = RANK_SORT_ORDER[left.card.rank] - RANK_SORT_ORDER[right.card.rank]
    if (byRank !== 0) {
      return byRank
    }
    const bySuit = SUIT_SORT_ORDER[left.card.suit] - SUIT_SORT_ORDER[right.card.suit]
    if (bySuit !== 0) {
      return bySuit
    }
    return left.index - right.index
  })
}

type Seat = {
  id: string
  name: string
  profile: PlayerProfile
  cardCount: number
  topCard: Card | null
  x: number
  y: number
  isMe: boolean
}

function getRingRadiusPercent(playerCount: number): { x: number; y: number } {
  if (playerCount <= 2) {
    return { x: 40, y: 30 }
  }
  if (playerCount === 3) {
    return { x: 43, y: 32 }
  }
  if (playerCount === 4) {
    return { x: 44, y: 33 }
  }
  return { x: 45, y: 34 }
}

function App() {
  const initialSlots = useMemo(() => loadStoredProfileSlots(), [])
  const [isLoggedIn, setIsLoggedIn] = useState(() => sessionStorage.getItem(LOGIN_SESSION_STORAGE_KEY) === '1')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginInfo, setLoginInfo] = useState('')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [name, setName] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<ClientStatePayload | null>(null)
  const [account, setAccount] = useState<PlayerAccountState>(createEmptyAccount())
  const [shopCatalog, setShopCatalog] = useState<ShopCatalogItem[]>([])
  const [pendingShopKey, setPendingShopKey] = useState('')
  const [activeProfileSlot, setActiveProfileSlot] = useState<PlayerProfile['profileSlot']>(PROFILE_SLOT_OPTIONS[0])
  const [profileSlots, setProfileSlots] = useState<ProfileSlotMap>(initialSlots)
  const [profileDraft, setProfileDraft] = useState<PlayerProfile>(withSlot(initialSlots.A, 'A'))
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [showTableWindow, setShowTableWindow] = useState(false)
  const [showProfileWindow, setShowProfileWindow] = useState(false)
  const [draggedCardIndex, setDraggedCardIndex] = useState<number | null>(null)
  const [playingHandSortMode, setPlayingHandSortMode] = useState<PlayingHandSortMode>('suit')

  useEffect(() => {
    const s = io(SERVER_URL)
    s.on('state_sync', (nextPayload: ClientStatePayload) => {
      const normalizedPlayers = nextPayload.state.players.map((player, index) => ({
        ...player,
        profile: isPlayerProfile(player.profile)
          ? player.profile
          : createDefaultProfile(PROFILE_SLOT_OPTIONS[index % PROFILE_SLOT_OPTIONS.length]),
      }))

      const normalizedPayload: ClientStatePayload = {
        ...nextPayload,
        account: nextPayload.account ?? createEmptyAccount(),
        state: {
          ...nextPayload.state,
          players: normalizedPlayers,
        },
      }

      setPayload(normalizedPayload)
      setAccount(normalizedPayload.account)
      const myPlayer = normalizedPayload.state.players.find((player) => player.id === normalizedPayload.yourPlayerId)
      if (myPlayer?.profile) {
        const slot = myPlayer.profile.profileSlot ?? PROFILE_SLOT_OPTIONS[0]
        setActiveProfileSlot(slot)
        setProfileSlots((current) => {
          const next = { ...current, [slot]: withSlot(myPlayer.profile, slot) }
          sessionStorage.setItem(PROFILE_SLOTS_STORAGE_KEY, JSON.stringify(next))
          return next
        })
        setProfileDraft(withSlot(myPlayer.profile, slot))
      }
      setSelectedTargetId((current) => current || normalizedPayload.state.players[0]?.id || '')
    })
    setSocket(s)
    return () => {
      s.disconnect()
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(PROFILE_SLOTS_STORAGE_KEY, JSON.stringify(profileSlots))
  }, [profileSlots])

  useEffect(() => {
    setProfileDraft(withSlot(profileSlots[activeProfileSlot], activeProfileSlot))
  }, [activeProfileSlot, profileSlots])

  useEffect(() => {
    if (!payload) {
      return
    }
    refreshAccount()
    refreshShopCatalog()
  }, [payload?.yourPlayerId])

  const shopByType = useMemo(() => {
    const grouped: Record<ShopItemType, ShopCatalogItem[]> = {
      effect: [],
      skin: [],
      hat: [],
      avatar: [],
    }

    for (const item of shopCatalog) {
      grouped[item.type].push(item)
    }

    return grouped
  }, [shopCatalog])

  function itemOwned(type: ShopItemType, id: string): boolean {
    if (type === 'avatar') {
      return account.unlocked.avatars.includes(id as PlayerProfile['avatarId'])
    }
    if (type === 'hat') {
      return account.unlocked.hats.includes(id as PlayerProfile['hatId'])
    }
    if (type === 'skin') {
      return account.unlocked.skins.includes(id as PlayerProfile['skinId'])
    }
    return account.unlocked.effects.includes(id as PlayerProfile['effectId'])
  }

  function findCatalogItem(type: ShopItemType, id: string): ShopCatalogItem | undefined {
    return shopCatalog.find((item) => item.type === type && item.id === id)
  }

  function itemCost(type: ShopItemType, id: string): number {
    const item = findCatalogItem(type, id)
    if (item) {
      return item.cost
    }

    if (type === 'avatar') {
      return RARITY_PRICES[AVATAR_RARITY[id as PlayerProfile['avatarId']]]
    }
    if (type === 'hat') {
      return RARITY_PRICES[HAT_RARITY[id as PlayerProfile['hatId']]]
    }
    if (type === 'skin') {
      return RARITY_PRICES[SKIN_RARITY[id as PlayerProfile['skinId']]]
    }
    return RARITY_PRICES[EFFECT_RARITY[id as PlayerProfile['effectId']]]
  }

  function itemRarity(type: ShopItemType, id: string): RarityId {
    const item = findCatalogItem(type, id)
    if (item) {
      return item.rarity
    }

    if (type === 'avatar') {
      return AVATAR_RARITY[id as PlayerProfile['avatarId']]
    }
    if (type === 'hat') {
      return HAT_RARITY[id as PlayerProfile['hatId']]
    }
    if (type === 'skin') {
      return SKIN_RARITY[id as PlayerProfile['skinId']]
    }
    return EFFECT_RARITY[id as PlayerProfile['effectId']]
  }

  function isLocked(type: ShopItemType, id: string): boolean {
    return !itemOwned(type, id)
  }

  const me = useMemo(
    () => payload?.state.players.find((p) => p.id === payload.yourPlayerId) ?? null,
    [payload],
  )

  const profilePanelProfile = useMemo(
    () => me?.profile ?? profileDraft,
    [me, profileDraft],
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
  const sortedPlayingHand = useMemo<PlayingHandEntry[]>(() => {
    if (!payload) {
      return []
    }
    const entries = payload.yourHand.map((card, index) => ({ card, index }))
    return sortPlayingHandEntries(entries, playingHandSortMode)
  }, [payload, playingHandSortMode])

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
        profile: p.profile,
        cardCount: p.cardCount,
        topCard: p.topCard,
        x: 50 + Math.cos(angleRad) * radius.x,
        y: 50 + Math.sin(angleRad) * radius.y,
        isMe: p.id === payload.yourPlayerId,
      }
    })
  }, [payload])

  const finalStandings = useMemo(() => {
    if (!payload || payload.state.phase !== 'FINISHED') {
      return []
    }

    const rankedPlayers = payload.state.finalRankingPlayerIds
      .map((id) => payload.state.players.find((player) => player.id === id))
      .filter((player): player is NonNullable<typeof player> => Boolean(player))

    const missingPlayers = payload.state.players.filter(
      (player) => !rankedPlayers.some((rankedPlayer) => rankedPlayer.id === player.id),
    )

    return [...rankedPlayers, ...missingPlayers]
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

  function refreshAccount(): void {
    emitAck('get_account', {}, (response) => {
      setAccount((response.account as PlayerAccountState) ?? createEmptyAccount())
    })
  }

  function refreshShopCatalog(): void {
    emitAck('get_shop_catalog', {}, (response) => {
      if (Array.isArray(response.catalog)) {
        setShopCatalog(response.catalog as ShopCatalogItem[])
      }
    })
  }

  function buyShopItem(itemType: ShopItemType, itemId: string): void {
    if (!socket) {
      return
    }
    const shopKey = `${itemType}:${itemId}`
    setPendingShopKey(shopKey)
    setError('')
    socket.emit('purchase_shop_item', { itemType, itemId }, (response: { ok: boolean; error?: string; account?: PlayerAccountState; catalog?: ShopCatalogItem[] }) => {
      setPendingShopKey('')
      if (!response?.ok) {
        setError(response?.error ?? 'Server error')
        return
      }
      setAccount(response.account ?? createEmptyAccount())
      if (Array.isArray(response.catalog)) {
        setShopCatalog(response.catalog)
      }
    })
  }

  function createRoom(): void {
    emitAck('create_room', { name: name || 'Player', profile: withSlot(profileDraft, activeProfileSlot) }, (response) => {
      setRoomCode(response.roomCode as string)
      setRoomCodeInput(response.roomCode as string)
      sessionStorage.setItem(playerStorageKey(String(response.roomCode)), String(response.playerId))
      refreshAccount()
      refreshShopCatalog()
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
        profile: withSlot(profileDraft, activeProfileSlot),
      },
      (response) => {
        setRoomCode(normalized)
        sessionStorage.setItem(playerStorageKey(normalized), String(response.playerId))
        refreshAccount()
        refreshShopCatalog()
      },
    )
  }

  function sendAction(action: TurnAction): void {
    emitAck('take_turn_action', { action })
  }

  function updateProfileDraft(update: (current: PlayerProfile) => PlayerProfile): void {
    setProfileDraft((current) => {
      const next = withSlot(update(current), activeProfileSlot)
      setProfileSlots((slots) => ({ ...slots, [activeProfileSlot]: next }))
      return next
    })
  }

  function saveProfile(): void {
    const profileToSave = withSlot(profileDraft, activeProfileSlot)
    setProfileSlots((slots) => ({ ...slots, [activeProfileSlot]: profileToSave }))

    if (!payload) {
      return
    }
    if (payload.state.phase !== 'LOBBY') {
      setError('Profili galima taikyti tik laukimo fazeje')
      return
    }

    emitAck('update_profile', { profile: profileToSave })
  }

  function resetProfileDraft(): void {
    const reset = createDefaultProfile(activeProfileSlot)
    setProfileDraft(reset)
    setProfileSlots((slots) => ({ ...slots, [activeProfileSlot]: reset }))
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
              {(payload.yourHand.length > 1 ? payload.yourHand.slice(0, payload.yourHand.length - 1) : payload.yourHand).map((card, idx) => (
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

  function renderProfileBadge(profile: PlayerProfile, compact = false, displayName?: string) {
    const powerValue = getProfilePower(profile)
    const unlockGames = EFFECT_GAMES_REQUIRED[profile.effectId]
    const tierLabel = EFFECT_TIER_LABELS[profile.effectId]
    const rarityId = EFFECT_RARITY[profile.effectId]
    const rarityCost = RARITY_PRICES[rarityId]
    const style = {
      '--profile-accent': profile.baseColor,
      '--profile-accent-soft': hexToRgba(profile.baseColor, compact ? 0.2 : 0.28),
    } as CSSProperties

    const badgeClass = compact
      ? `profileBadge compact fx-${profile.effectId} avatar-${profile.avatarId}`
      : `profileBadge fx-${profile.effectId} avatar-${profile.avatarId}`

    return (
      <div className={badgeClass} style={style}>
        <div className="profileCardHeader">
          <span className={`profileCardTier tier-${profile.effectId}`}>{tierLabel}</span>
          <span className="profileCardSlot" role="note" aria-label={`Rarity ${tierLabel}, unlocked after ${unlockGames} played games`}>
            {slotToRoman(profile.profileSlot)}
            <span className="profileSlotTooltip">
              <strong>Tier: {tierLabel}</strong>
              <span>Price: {rarityCost} points.</span>
              <span>Reference unlock pace: around {unlockGames} played games.</span>
            </span>
          </span>
        </div>

        <div className="profileCardStage">
          <div className="profileCardBackdrop" />
          <div className={compact ? `miniCharacter compact avatarStyle-${profile.avatarId}` : `miniCharacter avatarStyle-${profile.avatarId}`}>
            <div className={`miniAura effect-${profile.effectId}`} />
            <div className={`miniHat hat-${profile.hatId}`} />
            <div className={`miniHead avatar-${profile.avatarId}`}>
              {profile.avatarId === 'zeus' ? (
                <>
                  <span className="avatarCrown" />
                  <span className="avatarBeard" />
                  <span className="avatarLightningMark" />
                </>
              ) : null}
              {profile.avatarId === 'wizard' ? (
                <>
                  <span className="avatarWizardHat" />
                  <span className="avatarCrownMark" />
                  <span className="avatarWizardRune" />
                  <span className="avatarWizardBeard" />
                </>
              ) : null}
              {profile.avatarId === 'pablo' ? (
                <>
                  <span className="avatarPabloHat" />
                  <span className="avatarPabloMoustache" />
                  <span className="avatarPabloGlass" />
                </>
              ) : null}
              <span className="avatarBrow left" />
              <span className="avatarBrow right" />
              <span className="miniEye left" />
              <span className="miniEye right" />
              <span className="avatarNose" />
              <span className="avatarMouth" />
            </div>
            <div className="avatarWeapon" />
            <div className="miniArms">
              <span className="left" />
              <span className="right" />
            </div>
            <div className={`miniBody skin-${profile.skinId}`}>
              <span className="miniBodyMark" />
            </div>
            <div className="miniLegs">
              <span />
              <span />
            </div>
          </div>
          <div className={`profileCardPowerWrap rarity-${profile.effectId}`}>
            <span className="profileCardPower">{powerValue.toLocaleString('lt-LT')}</span>
            <span className="profileCardCoin">◉</span>
          </div>
        </div>

        <div className="profileCardName">{displayName?.trim() || AVATAR_LABELS[profile.avatarId]}</div>

        <div className="profileCardTags">
          <span className="profileCardTag rarity">{tierLabel}</span>
          <span className="profileCardTag element">{AVATAR_ELEMENT_LABELS[profile.avatarId]}</span>
          <span className="profileCardTag theme">{AVATAR_THEME_LABELS[profile.avatarId]}</span>
        </div>

        <div className="profileCardFooter">
          <span>{HAT_LABELS[profile.hatId]}</span>
          <span>{SKIN_LABELS[profile.skinId]}</span>
        </div>
      </div>
    )
  }

  function handleLogin(): void {
    const username = loginUsername.trim()
    const password = loginPassword.trim()
    setLoginInfo('')

    if (!username || !password) {
      setLoginError('Ivesk varda ir slaptazodi')
      return
    }

    setLoginError('')
    sessionStorage.setItem(LOGIN_SESSION_STORAGE_KEY, '1')
    setIsLoggedIn(true)
    setName((current) => current || username)
  }

  function handleRegister(): void {
    const username = loginUsername.trim()
    const password = loginPassword.trim()

    if (!username || !password) {
      setLoginInfo('')
      setLoginError('Ivesk varda ir slaptazodi registracijai')
      return
    }

    const raw = localStorage.getItem(REGISTERED_USERS_STORAGE_KEY)
    const users = raw ? (JSON.parse(raw) as string[]) : []
    if (users.includes(username)) {
      setLoginInfo('')
      setLoginError('Toks vartotojas jau egzistuoja')
      return
    }

    localStorage.setItem(REGISTERED_USERS_STORAGE_KEY, JSON.stringify([...users, username]))
    setLoginError('')
    setLoginInfo('Registracija sekminga. Dabar spausk Prisijungti.')
  }

  function handleLogout(): void {
    sessionStorage.removeItem(LOGIN_SESSION_STORAGE_KEY)
    setIsLoggedIn(false)
    setLoginPassword('')
    setLoginError('')
    setLoginInfo('')
    setPayload(null)
    setRoomCode('')
    setRoomCodeInput('')
    setShowTableWindow(false)
    setShowProfileWindow(false)
  }

  if (!isLoggedIn) {
    return (
      <div className="page">
        <section className="panel loginPanel">
          <h1>Prisijungimas</h1>
          <p className="loginHint">Paprastas prisijungimas i Fasiolas zaidima</p>
          <div className="row">
            <label htmlFor="login-name">Vartotojas</label>
            <input
              id="login-name"
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              placeholder="Ivesk varda"
            />
          </div>
          <div className="row">
            <label htmlFor="login-password">Slaptazodis</label>
            <input
              id="login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Ivesk slaptazodi"
            />
          </div>
          <div className="actions">
            <button type="button" onClick={handleLogin}>Prisijungti</button>
            <button type="button" onClick={handleRegister}>Registruotis</button>
          </div>
          {loginInfo ? <div className="success">{loginInfo}</div> : null}
          {loginError ? <div className="error">{loginError}</div> : null}
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <header>
        <div className="headerRow">
          <div>
            <h1>Fasiolas</h1>
            <p>Kortu zaidimo prototipas</p>
          </div>
          <button type="button" onClick={handleLogout}>Atsijungti</button>
        </div>
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

        <div className={`profileQuickPanel quick-effect-${profilePanelProfile.effectId}`}>
          <div className="profileQuickInfo">
            <strong>Profilio langelis</strong>
            <span>Slotas {activeProfileSlot} | Taskai {account.points} | Zaidimai {account.gamesPlayed}</span>
          </div>
          {renderProfileBadge(profilePanelProfile, true, name || me?.name)}
          <div className="actions">
            <button type="button" onClick={() => setShowProfileWindow(true)}>Atidaryti profilio langeli</button>
            <button type="button" onClick={saveProfile}>Issaugoti ir pritaikyti</button>
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>

      {(roomCode || (payload && payload.state.phase === 'LOBBY')) ? (
        <section className="panel status">
          <h2>Lobby</h2>
          <div>Kambario kodas: {payload?.state.roomCode ?? roomCode}</div>
          <div>Faze: {payload?.state.phase ?? 'LOBBY'}</div>
          <div>Zaidejai: {payload?.state.players.length ?? 1}</div>
          {payload?.state.phase === 'LOBBY' ? (
            <div className="players">
              {payload.state.players.map((p) => (
                <article key={`lobby-${p.id}`} className={p.id === payload.yourPlayerId ? 'player me' : 'player'}>
                  <strong>{p.name}</strong>
                  <span>ID: {p.id.slice(0, 8)}</span>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {showProfileWindow ? (
        <section className="profileWindowOverlay" role="dialog" aria-modal="true" aria-label="Profilio langelis">
          <article className={`profileWindow panel window-effect-${profileDraft.effectId}`}>
            <div className="profileWindowHeader">
              <h2>Profilio langelis</h2>
              <button type="button" onClick={() => setShowProfileWindow(false)}>Uzdaryti</button>
            </div>

            <div className="profileWindowBody">
              <div className="loadoutStage">
                {renderProfileBadge(profileDraft, false, name || me?.name)}
                <p>Siame lange kuriamas tavo veikejo stilius ir issaugomas i pasirinkta lizda.</p>
              </div>

              <div className="customizationPanel">
                <div className="slotSelector" role="tablist" aria-label="Profilio lizdai">
                  {PROFILE_SLOT_OPTIONS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      role="tab"
                      aria-selected={activeProfileSlot === slot}
                      className={activeProfileSlot === slot ? 'slotButton active' : 'slotButton'}
                      onClick={() => setActiveProfileSlot(slot)}
                    >
                      Lizdas {slot}
                    </button>
                  ))}
                </div>

                <div className="customizationGrid">
                  <div className="row">
                    <label htmlFor="avatar">Ikona</label>
                    <select
                      id="avatar"
                      value={profileDraft.avatarId}
                      onChange={(event) => updateProfileDraft((current) => ({ ...current, avatarId: event.target.value as PlayerProfile['avatarId'] }))}
                    >
                      {AVATAR_OPTIONS.map((avatar) => {
                        const rarity = itemRarity('avatar', avatar)
                        const cost = itemCost('avatar', avatar)
                        const locked = isLocked('avatar', avatar)
                        return (
                          <option key={avatar} value={avatar} disabled={locked}>
                            {locked
                              ? `${AVATAR_LABELS[avatar]} (${RARITY_LABELS[rarity]} ${cost} pts, locked)`
                              : `${AVATAR_LABELS[avatar]} (${RARITY_LABELS[rarity]})`}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="row">
                    <label htmlFor="hat">Kepure</label>
                    <select
                      id="hat"
                      value={profileDraft.hatId}
                      onChange={(event) => updateProfileDraft((current) => ({ ...current, hatId: event.target.value as PlayerProfile['hatId'] }))}
                    >
                      {HAT_OPTIONS.map((hat) => {
                        const rarity = itemRarity('hat', hat)
                        const cost = itemCost('hat', hat)
                        const locked = isLocked('hat', hat)
                        return (
                          <option key={hat} value={hat} disabled={locked}>
                            {locked
                              ? `${HAT_LABELS[hat]} (${RARITY_LABELS[rarity]} ${cost} pts, locked)`
                              : `${HAT_LABELS[hat]} (${RARITY_LABELS[rarity]})`}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="row">
                    <label htmlFor="skin">Skin</label>
                    <select
                      id="skin"
                      value={profileDraft.skinId}
                      onChange={(event) => updateProfileDraft((current) => ({ ...current, skinId: event.target.value as PlayerProfile['skinId'] }))}
                    >
                      {SKIN_OPTIONS.map((skin) => {
                        const rarity = itemRarity('skin', skin)
                        const cost = itemCost('skin', skin)
                        const locked = isLocked('skin', skin)
                        return (
                          <option key={skin} value={skin} disabled={locked}>
                            {locked
                              ? `${SKIN_LABELS[skin]} (${RARITY_LABELS[rarity]} ${cost} pts, locked)`
                              : `${SKIN_LABELS[skin]} (${RARITY_LABELS[rarity]})`}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="row">
                    <label htmlFor="effect">Efektas</label>
                    <select
                      id="effect"
                      value={profileDraft.effectId}
                      onChange={(event) => updateProfileDraft((current) => ({ ...current, effectId: event.target.value as PlayerProfile['effectId'] }))}
                    >
                      {EFFECT_OPTIONS.map((effect) => {
                        const rarity = itemRarity('effect', effect)
                        const cost = itemCost('effect', effect)
                        const locked = isLocked('effect', effect)
                        return (
                          <option key={effect} value={effect} disabled={locked}>
                            {locked
                              ? `${EFFECT_LABELS[effect]} (${RARITY_LABELS[rarity]} ${cost} pts, locked)`
                              : `${EFFECT_LABELS[effect]} (${RARITY_LABELS[rarity]})`}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                </div>

                <div className="shopPanel" aria-label="Shop panel">
                  <div className="shopPanelHeader">
                    <strong>Shop</strong>
                    <span>Taskai: {account.points} | Zaidimai: {account.gamesPlayed}</span>
                  </div>
                  <p className="shopPanelHint">Kiekvienas match: +20 tasku visiems, Top3 bonusai: +20 / +10 / +5.</p>

                  {SHOP_SECTION_ORDER.map((sectionType) => (
                    <div key={sectionType} className="shopSection">
                      <h4>{SHOP_SECTION_LABELS[sectionType]}</h4>
                      <div className="shopItemsGrid">
                        {shopByType[sectionType].length === 0 ? (
                          <span className="shopLoadingHint">Katalogas kraunamas...</span>
                        ) : null}
                        {shopByType[sectionType].map((item) => {
                          const owned = itemOwned(item.type, String(item.id))
                          const canAfford = account.points >= item.cost
                          const itemKey = `${item.type}:${String(item.id)}`
                          const isPending = pendingShopKey === itemKey
                          const label = SHOP_ITEM_LABELS[item.type][String(item.id)] ?? String(item.id)

                          return (
                            <article key={itemKey} className={`shopItemCard rarity-${item.rarity} ${owned ? 'owned' : 'locked'}`}>
                              <div className="shopItemTop">
                                <strong>{label}</strong>
                                <span className="shopRarityChip">{RARITY_LABELS[item.rarity]}</span>
                              </div>
                              <div className="shopItemMeta">
                                <span>{item.cost} pts</span>
                                <span>{owned ? 'Owned' : 'Locked'}</span>
                              </div>
                              <button
                                type="button"
                                disabled={owned || !canAfford || isPending}
                                onClick={() => buyShopItem(item.type, String(item.id))}
                              >
                                {owned ? 'Owned' : isPending ? 'Perkama...' : canAfford ? 'Pirkti' : 'Truksta tasku'}
                              </button>
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="colorPickerRow">
                  <span>Pagrindine spalva</span>
                  <div className="colorSwatches">
                    {PROFILE_COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={profileDraft.baseColor === color ? 'colorSwatch active' : 'colorSwatch'}
                        style={{ backgroundColor: color }}
                        onClick={() => updateProfileDraft((current) => ({ ...current, baseColor: color }))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="customizationFooter">
              <button type="button" onClick={resetProfileDraft}>Atstatyti aktyvu lizda</button>
              <button type="button" onClick={saveProfile}>Issaugoti ir pritaikyti</button>
            </div>
          </article>
        </section>
      ) : null}

      {showTableWindow && payload && payload.state.phase !== 'LOBBY' ? (
        <section className="tableWindowOverlay">
          <article className="tableWindow panel">
            <div className="tableWindowHeader">
              <h2>Stalo langas</h2>
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

              {payload.state.pendingFasiolas &&
              payload.state.pendingFasiolas.requiredFromPlayerIds.includes(payload.yourPlayerId) &&
              !payload.state.pendingFasiolas.contributedFromPlayerIds.includes(payload.yourPlayerId) ? (
                <div className="fasiolasContributionDock">
                  <strong>Atiduok korta fasiolui</strong>
                  <span>Pasirink ne virsutine korta</span>
                  <div className="fasiolasContributionButtons">
                    {(payload.yourHand.length > 1 ? payload.yourHand.slice(0, payload.yourHand.length - 1) : payload.yourHand).map((card, idx) => (
                      <button
                        key={`dock-contrib-${card.rank}${card.suit}-${idx}`}
                        type="button"
                        className="fasiolasCardPick"
                        onClick={() => emitAck('resolve_fasiolas', { cardIndex: idx })}
                        title={`Atiduoti ${cardLabel(card)}`}
                      >
                        {renderVisualCard(card, true)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {payload.state.trumpSuit ? (
                <div className="tableTrumpBadge" aria-label="Kozerio zenklas">
                  <span className="tableTrumpBadgeLabel">Kozeris</span>
                  <span className={`tableTrumpBadgeSuit ${cardColorClass(payload.state.trumpSuit)}`}>
                    {suitSymbol(payload.state.trumpSuit)}
                  </span>
                </div>
              ) : null}

              {payload.state.phase === 'PLAYING' ? (
                <div className="playingActionDock">
                  <strong>2 dalis: zaidimas</strong>
                  <div className="playingActionSortRow">
                    <button
                      type="button"
                      className={playingHandSortMode === 'suit' ? 'playingSortButton active' : 'playingSortButton'}
                      onClick={() => setPlayingHandSortMode('suit')}
                    >
                      Rikiuoti pagal zenkla
                    </button>
                    <button
                      type="button"
                      className={playingHandSortMode === 'rank' ? 'playingSortButton active' : 'playingSortButton'}
                      onClick={() => setPlayingHandSortMode('rank')}
                    >
                      Rikiuoti pagal verte
                    </button>
                  </div>
                  <div className="playingActionCards">
                    {sortedPlayingHand.map(({ card, index }) => (
                      <button
                        key={`playing-dock-${card.rank}${card.suit}-${index}`}
                        type="button"
                        className="playingActionCardPick"
                        disabled={!isMyTurn}
                        onClick={() => sendAction({ type: 'PLAY_CARD', cardIndex: index })}
                        title={`Zaisti ${cardLabel(card)}`}
                      >
                        {renderVisualCard(card, true)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={!isMyTurn}
                    onClick={() => sendAction({ type: 'TAKE_OLDEST' })}
                  >
                    Paimti seniausia nuo stalo
                  </button>
                </div>
              ) : null}

              <div
                className={draggedCardIndex !== null && payload.state.phase === 'PLAYING' ? 'roundTableCenter dropTarget' : 'roundTableCenter'}
                onDragOver={allowDrop}
                onDrop={handleCenterDrop}
              >
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

                {payload.state.phase === 'PLAYING' ? (
                  <div className="tableCenterStack" aria-label="Stalo kortos">
                    {payload.state.tableStack.map((card, index) => (
                      <div key={`center-stack-${card.rank}${card.suit}-${index}`} className="tableCenterStackCard">
                        {renderVisualCard(card, true)}
                      </div>
                    ))}
                  </div>
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
                  <div className="seatIdentity">
                    <div className={seat.isMe ? 'seatIdentityRow meSeatIdentityRow' : 'seatIdentityRow opponentSeatIdentityRow'}>
                      {renderProfileBadge(seat.profile, true, seat.name)}
                      {payload.state.phase !== 'PLAYING'
                        ? seat.topCard ? (
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
                                  ? seat.isMe
                                    ? 'seatTopCard mySeatTopCard draggableCard'
                                    : 'seatTopCard opponentTopCard draggableCard'
                                  : seat.isMe
                                    ? 'seatTopCard mySeatTopCard'
                                    : 'seatTopCard opponentTopCard'
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
                          )
                        : null}
                    </div>
                  </div>
                  <span>Kortos: {seat.cardCount}</span>
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
            {me ? <div className="statusProfile">{renderProfileBadge(me.profile, true, me.name)}</div> : null}
          </section>

          <section className="panel">
            <h2>Zaideju langelis</h2>
            <div className="players">
              {payload.state.players.map((p) => (
                <article key={p.id} className={p.id === payload.yourPlayerId ? 'player me' : 'player'}>
                  {renderProfileBadge(p.profile, true, p.name)}
                  <strong>{p.name}</strong>
                  <span>ID: {p.id.slice(0, 8)}</span>
                  <span>Kortos: {p.cardCount}</span>
                  <span>Virsus: {cardLabel(p.topCard)}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Stalo busena</h2>
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
            <h2>Zaidimo zurnalas</h2>
            <ul className="log">
              {payload.state.dealerLog.map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {me && payload?.state.phase === 'FINISHED' ? (
        <section className="resultsOverlay" role="dialog" aria-modal="true" aria-label="Zaidimo rezultatai">
          <article className="resultsDialog">
            <h2>{payload.state.loserPlayerId === me.id ? 'Pralaimejai partija' : 'Partija baigta'}</h2>
            <p className="resultsSubtitle">Galutiniai zaidimo rezultatai</p>

            <div className="resultsTableWrap">
              <table className="resultsTable">
                <thead>
                  <tr>
                    <th>Vieta</th>
                    <th>Zaidejas</th>
                    <th>Statusas</th>
                    <th>Kortos</th>
                  </tr>
                </thead>
                <tbody>
                  {finalStandings.map((player, index) => (
                    <tr key={`result-${player.id}`} className={index === 0 ? 'winnerRow' : ''}>
                      <td>#{index + 1}</td>
                      <td>{player.name}</td>
                      <td>{payload.state.loserPlayerId === player.id ? 'Pralaimejo' : 'Laimetojas'}</td>
                      <td>{player.cardCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  )
}

export default App
