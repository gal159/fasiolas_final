import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  AVATAR_PRICE_OVERRIDES,
  AVATAR_RARITY,
  AVATAR_OPTIONS,
  type AuthBootstrapPayload,
  CARD_BACKGROUND_OPTIONS,
  CARD_BACKGROUND_RARITY,
  EFFECT_RARITY,
  EFFECT_OPTIONS,
  HAT_OPTIONS,
  HAT_RARITY,
  PROFILE_COLOR_OPTIONS,
  PROFILE_SLOT_OPTIONS,
  RARITY_PRICES,
  SKIN_RARITY,
  SKIN_OPTIONS,
  TABLE_OPTIONS,
  TABLE_RARITY,
  type ActionAnimatedEvent,
  calcLevel,
  type Card,
  type ClientStatePayload,
  type PlayerAccountState,
  type PlayerCardInfo,
  type PlayerProfile,
  type ProfileSlotMap,
  type RarityId,
  type ShopCatalogItem,
  type ShopItemType,
  type TurnAction,
} from '../../shared/src/types'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const PROFILE_SLOTS_STORAGE_KEY = 'fasiolas:profile-slots'
const LOGIN_SESSION_STORAGE_KEY = 'fasiolas:logged-in'
const AUTH_USER_ID_STORAGE_KEY = 'fasiolas:auth-user-id'
const RESET_TOKEN_QUERY_KEY = 'resetToken'

const AVATAR_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Dzeusas',
  warrior: 'Riteris',
  mage: 'Magas',
  ronin: 'Zudikas',
  guardian: 'Elfas',
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

const CARD_BACKGROUND_LABELS: Record<PlayerProfile['cardBackgroundId'], string> = {
  classic: 'Klasikinis',
  crimson: 'Crimson flame',
  emerald: 'Emerald grove',
  midnight: 'Midnight arc',
  parchment: 'Ancient parchment',
}

const TABLE_LABELS: Record<PlayerProfile['tableId'], string> = {
  common_green: 'Zalias stalas',
  common_blue: 'Melynas stalas',
  common_purple: 'Violetinis stalas',
  common_red: 'Raudonas stalas',
  legendary_green: 'Karaliskas zalias',
  legendary_purple: 'Karaliskas violetinis',
  legendary_red: 'Karaliskas raudonas',
}

const AVATAR_ELEMENT_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Sky',
  warrior: 'Valor',
  mage: 'Arcane',
  ronin: 'Shadow',
  guardian: 'Nature',
}

const AVATAR_THEME_LABELS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'Olympus Court',
  warrior: 'Iron Oath',
  mage: 'Mystic Order',
  ronin: 'Night Veil',
  guardian: 'Forest Ward',
}

const AVATAR_ART_CLASS: Record<PlayerProfile['avatarId'], string> = {
  zeus: 'dzeusas',
  warrior: 'riteris',
  mage: 'magas',
  ronin: 'zudikas',
  guardian: 'elfas',
}

const RARITY_LABELS: Record<RarityId, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
}

const RARITY_GAMES_REQUIRED: Record<RarityId, number> = {
  common: 8,
  uncommon: 28,
  rare: 55,
  epic: 110,
  legendary: 180,
  mythic: 260,
}

const SHOP_SECTION_ORDER: ShopItemType[] = ['background', 'table', 'effect', 'avatar']

const SHOP_SECTION_LABELS: Record<ShopItemType, string> = {
  background: 'Card backgrounds',
  table: 'Stalai',
  effect: 'Effects',
  skin: 'Skins',
  hat: 'Hats',
  avatar: 'Avatars',
}

const SHOP_ITEM_LABELS: Record<ShopItemType, Record<string, string>> = {
  background: CARD_BACKGROUND_LABELS,
  table: TABLE_LABELS,
  effect: EFFECT_LABELS,
  skin: SKIN_LABELS,
  hat: HAT_LABELS,
  avatar: AVATAR_LABELS,
}

type AppStage = 'loading' | 'auth' | 'profileSetup' | 'hub'

type LeaderboardEntry = {
  playerName: string
  points: number
  gamesPlayed: number
  gamesWon: number
  gamesLost: number
  level: number
}

function createEmptyAccount(): PlayerAccountState {
  const defaultAvatars = AVATAR_OPTIONS.filter((id) => AVATAR_RARITY[id] === 'common')

  return {
    points: 0,
    registeredAt: Date.now(),
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    unlocked: {
      avatars: defaultAvatars,
      hats: HAT_OPTIONS.filter((id) => HAT_RARITY[id] === 'common'),
      skins: SKIN_OPTIONS.filter((id) => SKIN_RARITY[id] === 'common'),
      effects: EFFECT_OPTIONS.filter((id) => EFFECT_RARITY[id] === 'common'),
      backgrounds: CARD_BACKGROUND_OPTIONS.filter((id) => CARD_BACKGROUND_RARITY[id] === 'common'),
      tables: TABLE_OPTIONS.filter((id) => TABLE_RARITY[id] === 'common'),
    },
  }
}

function normalizeAccountState(account: PlayerAccountState | undefined): PlayerAccountState {
  const fallback = createEmptyAccount()
  if (!account) {
    return fallback
  }

  return {
    points: account.points ?? 0,
    registeredAt: account.registeredAt ?? fallback.registeredAt,
    gamesPlayed: account.gamesPlayed ?? 0,
    gamesWon: account.gamesWon ?? 0,
    gamesLost: account.gamesLost ?? 0,
    unlocked: {
      avatars: account.unlocked?.avatars ?? fallback.unlocked.avatars,
      hats: account.unlocked?.hats ?? fallback.unlocked.hats,
      skins: account.unlocked?.skins ?? fallback.unlocked.skins,
      effects: account.unlocked?.effects ?? fallback.unlocked.effects,
      backgrounds: account.unlocked?.backgrounds ?? fallback.unlocked.backgrounds,
      tables: account.unlocked?.tables ?? fallback.unlocked.tables,
    },
  }
}

function playerStorageKey(roomCode: string): string {
  return `fasiolas:${roomCode}`
}

function getStoredAuthUserId(): string | undefined {
  const value = sessionStorage.getItem(AUTH_USER_ID_STORAGE_KEY)?.trim()
  return value ? value : undefined
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

type PlayerAchievement = {
  id: string
  title: string
  unlocked: boolean
}

function buildPlayerAchievements(info: PlayerCardInfo): PlayerAchievement[] {
  const totalGames = info.gamesPlayed
  const winRate = totalGames > 0 ? (info.gamesWon / totalGames) * 100 : 0

  return [
    { id: 'starter', title: 'Starter', unlocked: totalGames >= 5 },
    { id: 'veteran', title: 'Veteran', unlocked: totalGames >= 25 },
    { id: 'winner', title: 'Winner', unlocked: info.gamesWon >= 10 },
    { id: 'unstoppable', title: 'Unstoppable', unlocked: totalGames >= 15 && winRate >= 60 },
  ]
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
    avatarId: 'warrior',
    hatId: 'none',
    skinId: 'default',
    effectId: 'none',
    cardBackgroundId: 'classic',
    tableId: 'common_green',
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

function isPlayerProfile(value: unknown): value is PlayerProfile {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  const avatarId = record.avatarId as string
  const avatarIsKnown = AVATAR_OPTIONS.includes(avatarId as PlayerProfile['avatarId']) || avatarId === 'wizard' || avatarId === 'pablo'

  return (
    typeof record.baseColor === 'string' &&
    PROFILE_COLOR_OPTIONS.includes(record.baseColor as PlayerProfile['baseColor']) &&
    typeof record.avatarId === 'string' &&
    avatarIsKnown &&
    typeof record.hatId === 'string' &&
    HAT_OPTIONS.includes(record.hatId as PlayerProfile['hatId']) &&
    typeof record.skinId === 'string' &&
    SKIN_OPTIONS.includes(record.skinId as PlayerProfile['skinId']) &&
    typeof record.effectId === 'string' &&
    EFFECT_OPTIONS.includes(record.effectId as PlayerProfile['effectId']) &&
    (typeof record.cardBackgroundId === 'undefined' ||
      (typeof record.cardBackgroundId === 'string' &&
        CARD_BACKGROUND_OPTIONS.includes(record.cardBackgroundId as PlayerProfile['cardBackgroundId']))) &&
    (typeof record.tableId === 'undefined' ||
      (typeof record.tableId === 'string' && TABLE_OPTIONS.includes(record.tableId as PlayerProfile['tableId']))) &&
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
        resolved[slot] = withSlot(normalizeLegacyProfile(candidate), slot)
      }
    }

    return resolved
  } catch {
    return fallback
  }
}

function resolveProfileSlots(value: unknown): ProfileSlotMap {
  const fallback = createDefaultProfileSlots()
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const parsed = value as Record<string, unknown>
  const resolved: ProfileSlotMap = { ...fallback }

  for (const slot of PROFILE_SLOT_OPTIONS) {
    const candidate = parsed[slot]
    if (isPlayerProfile(candidate)) {
      resolved[slot] = withSlot(normalizeLegacyProfile(candidate), slot)
    }
  }

  return resolved
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

function suitGlyphClass(suit: Card['suit']): string {
  if (suit === 'S') {
    return 'spade'
  }
  if (suit === 'H') {
    return 'heart'
  }
  if (suit === 'D') {
    return 'diamond'
  }
  return 'club'
}

function renderSuitGlyph(suit: Card['suit']) {
  const glyphClass = suitGlyphClass(suit)
  if (suit === 'S') {
    return (
      <svg className={`suitGlyph ${glyphClass}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2C9 6.2 4.2 8.6 4.2 13a4.5 4.5 0 0 0 7.8 3.1A4.5 4.5 0 0 0 19.8 13C19.8 8.6 15 6.2 12 2Z" />
        <path d="M12 15.6L9.6 21h4.8l-2.4-5.4Z" />
      </svg>
    )
  }
  if (suit === 'H') {
    return (
      <svg className={`suitGlyph ${glyphClass}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 21c-4.2-2.5-7.6-5.8-9.2-9A5.3 5.3 0 0 1 12 5.2 5.3 5.3 0 0 1 21.2 12c-1.6 3.2-5 6.5-9.2 9Z" />
      </svg>
    )
  }
  if (suit === 'D') {
    return (
      <svg className={`suitGlyph ${glyphClass}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.6 20.2 12 12 21.4 3.8 12 12 2.6Z" />
      </svg>
    )
  }
  return (
    <svg className={`suitGlyph ${glyphClass}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.3 16.6a3.8 3.8 0 0 1-3.8-3.8c0-2 1.3-3.4 2.8-4.7 1-.9 2-1.9 2.7-3.1.8 1.3 1.6 2.2 2.5 3.1.2.1.3.3.5.5.2-.2.3-.4.5-.5 1-.9 1.8-1.8 2.6-3.1.8 1.3 1.7 2.2 2.7 3.1 1.5 1.3 2.8 2.7 2.8 4.7a3.8 3.8 0 0 1-3.8 3.8 4 4 0 0 1-2.6-1A4.4 4.4 0 0 1 12 14a4.3 4.3 0 0 1-2 1.7 4 4 0 0 1-2.7 1Z" />
      <path d="M12 15.6 9.9 21h4.2L12 15.6Z" />
    </svg>
  )
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

function normalizeLegacyProfile(profile: PlayerProfile): PlayerProfile {
  const avatarAliases: Record<string, PlayerProfile['avatarId']> = {
    wizard: 'mage',
    pablo: 'warrior',
  }

  const normalizedBackground =
    typeof (profile as PlayerProfile & { cardBackgroundId?: string }).cardBackgroundId === 'string' &&
    CARD_BACKGROUND_OPTIONS.includes((profile as PlayerProfile & { cardBackgroundId?: string }).cardBackgroundId as PlayerProfile['cardBackgroundId'])
      ? ((profile as PlayerProfile & { cardBackgroundId?: string }).cardBackgroundId as PlayerProfile['cardBackgroundId'])
      : 'classic'

  const normalizedTable =
    typeof (profile as PlayerProfile & { tableId?: string }).tableId === 'string' &&
    TABLE_OPTIONS.includes((profile as PlayerProfile & { tableId?: string }).tableId as PlayerProfile['tableId'])
      ? ((profile as PlayerProfile & { tableId?: string }).tableId as PlayerProfile['tableId'])
      : 'common_green'

  const normalizedAvatar = avatarAliases[profile.avatarId] ?? profile.avatarId
  if (AVATAR_OPTIONS.includes(normalizedAvatar as PlayerProfile['avatarId'])) {
    return {
      ...profile,
      avatarId: normalizedAvatar as PlayerProfile['avatarId'],
      cardBackgroundId: normalizedBackground,
      tableId: normalizedTable,
    }
  }

  return {
    ...profile,
    avatarId: 'zeus',
    cardBackgroundId: normalizedBackground,
    tableId: normalizedTable,
  }
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

function displayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0]?.trim()
  return localPart || 'Player'
}

function App() {
  const initialSlots = useMemo(() => loadStoredProfileSlots(), [])
  const [appStage, setAppStage] = useState<AppStage>(() => (sessionStorage.getItem(LOGIN_SESSION_STORAGE_KEY) ? 'loading' : 'auth'))
  const [authEmail, setAuthEmail] = useState(() => sessionStorage.getItem(LOGIN_SESSION_STORAGE_KEY) ?? '')
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('')
  const [registerPlayerName, setRegisterPlayerName] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginInfo, setLoginInfo] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [name, setName] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
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
  const [showMarketplaceWindow, setShowMarketplaceWindow] = useState(false)
  const [draggedCardIndex, setDraggedCardIndex] = useState<number | null>(null)
  const [isRevealedCardDragged, setIsRevealedCardDragged] = useState(false)
  const [playingHandSortMode, setPlayingHandSortMode] = useState<PlayingHandSortMode>('suit')
  const [flyingPlayedCard, setFlyingPlayedCard] = useState<{
    card: Card
    fromX: number
    fromY: number
    toX: number
    toY: number
    width: number
    height: number
  } | null>(null)
  const [flyingRevealedCard, setFlyingRevealedCard] = useState<{
    card: Card
    fromX: number
    fromY: number
    toX: number
    toY: number
    width: number
    height: number
  } | null>(null)
  const centerDropRef = useRef<HTMLDivElement | null>(null)
  const playingCardButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const tableSeatRefs = useRef(new Map<string, HTMLDivElement>())
  const [flippedBadgeId, setFlippedBadgeId] = useState<string | null>(null)
  const [playerCardInfoCache, setPlayerCardInfoCache] = useState<Record<string, PlayerCardInfo>>({})
  const [loadingCardInfoId, setLoadingCardInfoId] = useState<string | null>(null)
  const flipContainerRef = useRef<HTMLDivElement | null>(null)

  function applyAuthBootstrap(bootstrap: AuthBootstrapPayload): void {
    const nextProfileSlots = resolveProfileSlots(bootstrap.profileSlots)
    const nextActiveProfileSlot = PROFILE_SLOT_OPTIONS.includes(bootstrap.activeProfileSlot)
      ? bootstrap.activeProfileSlot
      : PROFILE_SLOT_OPTIONS[0]
    const nextProfileDraft = withSlot(nextProfileSlots[nextActiveProfileSlot], nextActiveProfileSlot)
    const nextEmail = bootstrap.email.trim().toLowerCase()

    sessionStorage.setItem(LOGIN_SESSION_STORAGE_KEY, nextEmail)
    // KRITISKA: be authUserId kambarys kuriamas anonimiskai ir mačo
    // rezultatai (taskai, W/L) neissaugomi i paskyra.
    if (bootstrap.userId) {
      sessionStorage.setItem(AUTH_USER_ID_STORAGE_KEY, bootstrap.userId)
    }
    setAuthEmail(nextEmail)
    setName(bootstrap.playerName?.trim() || displayNameFromEmail(nextEmail))
    setAccount(normalizeAccountState(bootstrap.account))
    setProfileSlots(nextProfileSlots)
    setActiveProfileSlot(nextActiveProfileSlot)
    setProfileDraft(nextProfileDraft)
    setLoginError('')
    setError('')
    setShowMarketplaceWindow(false)
    setAppStage(bootstrap.hasCompletedProfileSetup ? 'hub' : 'profileSetup')
  }

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
        account: normalizeAccountState(nextPayload.account),
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
    // Kitu zaideju (ir botu) veiksmu animacijos: ivykis ateina PRIES state_sync,
    // tad DOM dar rodo sena busena - rect'ai paimami is teisingu vietu.
    s.on('action_animated', (info: ActionAnimatedEvent) => {
      animateRemoteAction(info)
    })
    setSocket(s)
    return () => {
      s.disconnect()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const token = params.get(RESET_TOKEN_QUERY_KEY)
    if (token) {
      setResetToken(token)
      setAuthMode('reset')
      setLoginInfo('Ivesk nauja slaptazodi')
      setLoginError('')
    }

    // Kvietimo nuoroda: ?room=KODAS uzpildo kambario lauka ir isvalo URL.
    const invitedRoom = params.get('room')?.trim().toUpperCase()
    if (invitedRoom) {
      setRoomCodeInput(invitedRoom)
      params.delete('room')
      const nextSearch = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`)
    }
  }, [])

  useEffect(() => {
    const storedEmail = sessionStorage.getItem(LOGIN_SESSION_STORAGE_KEY)?.trim().toLowerCase()
    if (!storedEmail) {
      setAppStage('auth')
      return
    }

    let cancelled = false

    const bootstrapSession = async (): Promise<void> => {
      try {
        const response = await fetch(`${SERVER_URL}/auth/bootstrap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: storedEmail }),
        })
        const payload = (await response.json()) as ({ ok: boolean; error?: string } & Partial<AuthBootstrapPayload>)
        if (cancelled) {
          return
        }
        if (!response.ok || !payload.ok || !payload.email || !payload.activeProfileSlot || !payload.profileSlots || !payload.account) {
          throw new Error(payload.error ?? 'Nepavyko atkurti sesijos')
        }

        applyAuthBootstrap(payload as AuthBootstrapPayload)
      } catch {
        if (cancelled) {
          return
        }
        sessionStorage.removeItem(LOGIN_SESSION_STORAGE_KEY)
        setAuthEmail('')
        setAppStage('auth')
        setLoginError('Sesija nebegalioja. Prisijunk is naujo.')
      }
    }

    void bootstrapSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(PROFILE_SLOTS_STORAGE_KEY, JSON.stringify(profileSlots))
  }, [profileSlots])

  useEffect(() => {
    if (!flippedBadgeId) return
    function handleClickAway(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.flipCard')) {
        setFlippedBadgeId(null)
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [flippedBadgeId])

  useEffect(() => {
    setProfileDraft(withSlot(profileSlots[activeProfileSlot], activeProfileSlot))
  }, [activeProfileSlot, profileSlots])

  useEffect(() => {
    if (appStage !== 'profileSetup') {
      return
    }
    const commonAvatars = AVATAR_OPTIONS.filter((avatar) => AVATAR_RARITY[avatar] === 'common')
    if (commonAvatars.length === 0) {
      return
    }
    function handleSetupKeys(event: KeyboardEvent): void {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      updateProfileDraft((current) => {
        const index = Math.max(0, commonAvatars.indexOf(current.avatarId))
        const nextAvatar = commonAvatars[(index + direction + commonAvatars.length) % commonAvatars.length]
        return { ...current, avatarId: nextAvatar }
      })
    }
    window.addEventListener('keydown', handleSetupKeys)
    return () => window.removeEventListener('keydown', handleSetupKeys)
  }, [appStage])

  useEffect(() => {
    if (!payload) {
      return
    }
    refreshAccount()
    refreshShopCatalog()
  }, [payload?.yourPlayerId])

  useEffect(() => {
    if (!socket) {
      return
    }
    refreshShopCatalog()
  }, [socket])

  useEffect(() => {
    if (!showMarketplaceWindow) {
      return
    }
    void refreshAccountFromAuth()
    refreshShopCatalog()
  }, [showMarketplaceWindow])

  useEffect(() => {
    if (!showLeaderboard) {
      return
    }
    let cancelled = false
    setLeaderboardLoading(true)
    fetch(`${SERVER_URL}/leaderboard`)
      .then((response) => response.json())
      .then((payload: { ok: boolean; players?: LeaderboardEntry[] }) => {
        if (!cancelled && payload.ok && payload.players) {
          setLeaderboard(payload.players)
        }
      })
      .catch(() => {
        // Palik sena sarasa, jei uzklausa nepavyko.
      })
      .finally(() => {
        if (!cancelled) {
          setLeaderboardLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [showLeaderboard])

  // Zaidimui pasibaigus atnaujinam paskyra is auth DB (taskai, W/L, lygis).
  // Nedidelis uzdelsimas, kad serveris spetu irasyti match rewards.
  const gamePhase = payload?.state.phase
  useEffect(() => {
    if (gamePhase !== 'FINISHED') {
      return
    }
    const timer = window.setTimeout(() => {
      void refreshAccountFromAuth()
      // Isvalom korteliu info cache, kad apvertus matytusi nauja statistika.
      setPlayerCardInfoCache({})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [gamePhase])

  const shopByType = useMemo(() => {
    const grouped: Record<ShopItemType, ShopCatalogItem[]> = {
      background: [],
      table: [],
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
    if (type === 'background') {
      return account.unlocked.backgrounds.includes(id as PlayerProfile['cardBackgroundId'])
    }
    if (type === 'table') {
      return (account.unlocked.tables ?? []).includes(id as PlayerProfile['tableId'])
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
      const override = AVATAR_PRICE_OVERRIDES[id as PlayerProfile['avatarId']]
      if (typeof override === 'number') {
        return override
      }
      return RARITY_PRICES[AVATAR_RARITY[id as PlayerProfile['avatarId']]]
    }
    if (type === 'hat') {
      return RARITY_PRICES[HAT_RARITY[id as PlayerProfile['hatId']]]
    }
    if (type === 'skin') {
      return RARITY_PRICES[SKIN_RARITY[id as PlayerProfile['skinId']]]
    }
    if (type === 'background') {
      return RARITY_PRICES[CARD_BACKGROUND_RARITY[id as PlayerProfile['cardBackgroundId']]]
    }
    if (type === 'table') {
      return RARITY_PRICES[TABLE_RARITY[id as PlayerProfile['tableId']]]
    }
    return RARITY_PRICES[EFFECT_RARITY[id as PlayerProfile['effectId']]]
  }

  function isItemEquipped(type: ShopItemType, id: string): boolean {
    if (type === 'avatar') {
      return profileDraft.avatarId === id
    }
    if (type === 'hat') {
      return profileDraft.hatId === id
    }
    if (type === 'skin') {
      return profileDraft.skinId === id
    }
    if (type === 'background') {
      return profileDraft.cardBackgroundId === id
    }
    if (type === 'table') {
      return profileDraft.tableId === id
    }
    return profileDraft.effectId === id
  }

  const accountLevel = useMemo(() => calcLevel(account.gamesPlayed), [account.gamesPlayed])
  const accountLevelProgress = useMemo(() => (account.gamesPlayed % 5) / 5, [account.gamesPlayed])
  const accountLevelGamesLeft = useMemo(() => {
    const modulo = account.gamesPlayed % 5
    return modulo === 0 ? 5 : 5 - modulo
  }, [account.gamesPlayed])

  function equipOwnedItem(itemType: ShopItemType, itemId: string): void {
    if (!itemOwned(itemType, itemId)) {
      return
    }

    updateProfileDraft((current) => {
      if (itemType === 'avatar') {
        return { ...current, avatarId: itemId as PlayerProfile['avatarId'] }
      }
      if (itemType === 'hat') {
        return { ...current, hatId: itemId as PlayerProfile['hatId'] }
      }
      if (itemType === 'skin') {
        return { ...current, skinId: itemId as PlayerProfile['skinId'] }
      }
      if (itemType === 'background') {
        return { ...current, cardBackgroundId: itemId as PlayerProfile['cardBackgroundId'] }
      }
      if (itemType === 'table') {
        return { ...current, tableId: itemId as PlayerProfile['tableId'] }
      }
      return { ...current, effectId: itemId as PlayerProfile['effectId'] }
    })
  }

  function renderMarketplacePanel(title = 'Marketplace', hint = 'Isleisk taskus kosmetikoms ir iskart naudok jas profilyje.') {
    return (
      <div className="shopPanel" aria-label="Marketplace panel">
        <div className="shopPanelHeader">
          <strong>{title}</strong>
          <span>Taskai: {account.points} | Zaidimai: {account.gamesPlayed}</span>
        </div>
        <p className="shopPanelHint">{hint}</p>
        {error ? <p className="shopPanelError">{error}</p> : null}

        {SHOP_SECTION_ORDER.map((sectionType) => (
          <div key={sectionType} className="shopSection">
            <h4>{SHOP_SECTION_LABELS[sectionType]}</h4>
            <div className="shopItemsGrid">
              {shopByType[sectionType].length === 0 ? (
                <span className="shopLoadingHint">Katalogas kraunamas...</span>
              ) : null}
              {shopByType[sectionType].map((item) => {
                const owned = itemOwned(item.type, String(item.id))
                const equipped = isItemEquipped(item.type, String(item.id))
                const canAfford = account.points >= item.cost
                const itemKey = `${item.type}:${String(item.id)}`
                const isPending = pendingShopKey === itemKey
                const label = SHOP_ITEM_LABELS[item.type][String(item.id)] ?? String(item.id)

                const previewClass =
                  item.type === 'table'
                    ? ` tablePreview-${String(item.id)}`
                    : item.type === 'background'
                      ? ` bgPreview-${String(item.id)}`
                      : item.type === 'effect' && String(item.id) !== 'none'
                        ? ` fxPreview-${String(item.id)}`
                        : item.type === 'avatar'
                          ? ` avatarPreview-${String(item.id)}`
                          : ''

                return (
                  <article key={itemKey} className={`shopItemCard rarity-${item.rarity} ${owned ? 'owned' : 'locked'}${previewClass}`}>
                    <div className="shopItemTop">
                      <strong>{label}</strong>
                      <span className="shopRarityChip">{RARITY_LABELS[item.rarity]}</span>
                    </div>
                    <div className="shopItemMeta">
                      <span>{item.cost} pts</span>
                      <span>{equipped ? 'Apsimauta' : owned ? 'Owned' : 'Locked'}</span>
                    </div>
                    <button
                      type="button"
                      disabled={(!owned && !canAfford) || isPending}
                      onClick={() => {
                        if (owned) {
                          equipOwnedItem(item.type, String(item.id))
                          return
                        }
                        buyShopItem(item.type, String(item.id))
                      }}
                    >
                      {equipped ? 'Apsimauta' : owned ? 'Apsimauti' : isPending ? 'Perkama...' : canAfford ? 'Pirkti' : 'Truksta tasku'}
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const sortedPlayingHand = useMemo(() => {
    if (!payload) {
      return []
    }

    const entries = payload.yourHand.map((card, index) => ({ card, index }))
    return sortPlayingHandEntries(entries, playingHandSortMode)
  }, [payload, playingHandSortMode])

  const me = useMemo(
    () => payload?.state.players.find((player) => player.id === payload.yourPlayerId) ?? null,
    [payload],
  )

  const isMyTurn = Boolean(payload && payload.state.currentTurnPlayerId === payload.yourPlayerId)

  const profilePanelProfile = useMemo(
    () => me?.profile ?? withSlot(profileDraft, activeProfileSlot),
    [activeProfileSlot, me, profileDraft],
  )

  const profilePanelDisplayName = useMemo(
    () => name || me?.name || displayNameFromEmail(authEmail),
    [authEmail, me?.name, name],
  )

  const showHandInCurrentPhase = Boolean(payload && payload.state.phase === 'PLAYING')

  const visibleHandIndices = useMemo(() => {
    if (!payload || payload.state.phase !== 'PLAYING') {
      return []
    }

    return payload.yourHand.map((_card, index) => index)
  }, [payload])

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
        y: p.id === payload.yourPlayerId ? 99 : 50 + Math.sin(angleRad) * radius.y,
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

  const statsLeaderboard = useMemo(() => {
    if (!payload) {
      return []
    }

    return payload.state.players
      .map((player) => {
        const fallbackInfo: PlayerCardInfo = {
          playerName: player.name,
          registeredAt: account.registeredAt,
          gamesPlayed: account.gamesPlayed,
          gamesWon: account.gamesWon,
          gamesLost: account.gamesLost,
          level: calcLevel(account.gamesPlayed),
        }

        const info = playerCardInfoCache[player.id] ?? (player.id === payload.yourPlayerId ? fallbackInfo : null)
        if (!info) {
          return null
        }

        const total = Math.max(1, info.gamesPlayed)
        const winRate = Math.round((info.gamesWon / total) * 100)

        return {
          playerId: player.id,
          playerName: info.playerName,
          level: info.level,
          gamesPlayed: info.gamesPlayed,
          gamesWon: info.gamesWon,
          gamesLost: info.gamesLost,
          winRate,
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((left, right) => {
        if (right.gamesWon !== left.gamesWon) {
          return right.gamesWon - left.gamesWon
        }
        if (right.level !== left.level) {
          return right.level - left.level
        }
        return right.gamesPlayed - left.gamesPlayed
      })
  }, [account.gamesLost, account.gamesPlayed, account.gamesWon, account.registeredAt, payload, playerCardInfoCache])

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
      setAccount(normalizeAccountState(response.account as PlayerAccountState))
    })
  }

  async function refreshAccountFromAuth(): Promise<void> {
    if (!authEmail) {
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail }),
      })
      const payload = (await response.json()) as ({ ok: boolean; error?: string } & Partial<AuthBootstrapPayload>)
      if (!response.ok || !payload.ok || !payload.account) {
        return
      }

      setAccount(normalizeAccountState(payload.account))
    } catch {
      // Keep current account value if auth refresh fails.
    }
  }

  const requestPlayerCardInfo = useCallback((playerId: string, showLoading = true) => {
    if (!socket) return
    if (showLoading) {
      setLoadingCardInfoId(playerId)
    }
    socket.emit('get_player_card_info', { targetPlayerId: playerId }, (response: any) => {
      if (showLoading) {
        setLoadingCardInfoId(null)
      }
      if (response?.ok) {
        setPlayerCardInfoCache((prev) => ({ ...prev, [playerId]: response as PlayerCardInfo }))
      }
    })
  }, [socket])

  const handleBadgeFlip = useCallback((playerId: string, event?: ReactMouseEvent<HTMLDivElement>) => {
    event?.preventDefault()
    event?.stopPropagation()

    // Kai laukia atversta korta ir mano ejimas - paspaudimas ant profilio
    // korteles deda korta tam zaidejui, o ne apvercia kortele.
    if (
      payload &&
      isMyTurn &&
      payload.state.phase === 'DEALING' &&
      payload.state.revealedDrawCard &&
      payload.state.players.some((p) => p.id === playerId)
    ) {
      handlePlaceRevealedWithSlide(playerId)
      return
    }

    if (flippedBadgeId === playerId) {
      setFlippedBadgeId(null)
      return
    }

    setFlippedBadgeId(playerId)
    if (!isUuid(playerId)) {
      return
    }
    if (playerCardInfoCache[playerId]) {
      return
    }
    requestPlayerCardInfo(playerId, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flippedBadgeId, playerCardInfoCache, requestPlayerCardInfo, payload, isMyTurn])

  useEffect(() => {
    if (!payload || !socket) {
      return
    }

    for (const player of payload.state.players) {
      if (!playerCardInfoCache[player.id]) {
        requestPlayerCardInfo(player.id, false)
      }
    }
  }, [payload, playerCardInfoCache, requestPlayerCardInfo, socket])

  function refreshShopCatalog(): void {
    emitAck('get_shop_catalog', {}, (response) => {
      if (Array.isArray(response.catalog)) {
        setShopCatalog(response.catalog as ShopCatalogItem[])
      }
    })
  }

  async function buyShopItem(itemType: ShopItemType, itemId: string): Promise<void> {
    const shopKey = `${itemType}:${itemId}`
    setPendingShopKey(shopKey)
    setError('')

    const canUseSocketPurchase = Boolean(socket && payload?.yourPlayerId)
    if (canUseSocketPurchase) {
      socket?.emit('purchase_shop_item', { itemType, itemId }, (response: { ok: boolean; error?: string; account?: PlayerAccountState; catalog?: ShopCatalogItem[] }) => {
        setPendingShopKey('')
        if (!response?.ok) {
          setError(response?.error ?? 'Server error')
          return
        }
        setAccount(normalizeAccountState(response.account))
        if (Array.isArray(response.catalog)) {
          setShopCatalog(response.catalog)
        }
      })
      return
    }

    if (!authEmail) {
      setPendingShopKey('')
      setError('Nerasta prisijungimo sesija')
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, itemType, itemId }),
      })
      const result = (await response.json()) as { ok: boolean; error?: string; account?: PlayerAccountState }
      if (!response.ok || !result.ok || !result.account) {
        setError(result.error ?? 'Server error')
        return
      }

      setAccount(normalizeAccountState(result.account))
    } catch {
      setError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
    } finally {
      setPendingShopKey('')
    }
  }

  function createRoom(): void {
    emitAck(
      'create_room',
      {
        name: name || 'Player',
        authUserId: getStoredAuthUserId(),
        profile: withSlot(profileDraft, activeProfileSlot),
      },
      (response) => {
      setRoomCode(response.roomCode as string)
      setRoomCodeInput(response.roomCode as string)
      sessionStorage.setItem(playerStorageKey(String(response.roomCode)), String(response.playerId))
      refreshAccount()
      refreshShopCatalog()
      },
    )
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
        authUserId: getStoredAuthUserId(),
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

  async function persistProfileSelection(completeSetup = false): Promise<boolean> {
    if (!authEmail) {
      setError('Nerasta prisijungimo sesija')
      return false
    }

    const profileToSave = withSlot(profileDraft, activeProfileSlot)

    try {
      const response = await fetch(`${SERVER_URL}/auth/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authEmail,
          activeProfileSlot,
          profile: profileToSave,
          completeSetup,
        }),
      })
      const payload = (await response.json()) as ({ ok: boolean; error?: string } & Partial<AuthBootstrapPayload>)
      if (!response.ok || !payload.ok || !payload.email || !payload.activeProfileSlot || !payload.profileSlots || !payload.account) {
        setError(payload.error ?? 'Nepavyko issaugoti profilio')
        return false
      }

      applyAuthBootstrap(payload as AuthBootstrapPayload)
      return true
    } catch {
      setError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
      return false
    }
  }

  async function saveProfile(applyToLobby = true): Promise<void> {
    const profileToSave = withSlot(profileDraft, activeProfileSlot)
    setProfileSlots((slots) => ({ ...slots, [activeProfileSlot]: profileToSave }))

    const saved = await persistProfileSelection(false)
    if (!saved) {
      return
    }

    if (!payload) {
      return
    }
    if (payload.state.phase !== 'LOBBY') {
      if (applyToLobby) {
        setError('Profilis issaugotas paskyroje. Ji galesi pritaikyti kitame lobby.')
      }
      return
    }

    setError('')
    emitAck('update_profile', { profile: profileToSave })
  }

  async function completeProfileSetup(): Promise<void> {
    const completed = await persistProfileSelection(true)
    if (!completed) {
      return
    }

    setAppStage('hub')
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
    if (!payload) {
      return
    }

    if (isRevealedCardDragged) {
      setIsRevealedCardDragged(false)
      if (isMyTurn && payload.state.phase === 'DEALING' && payload.state.revealedDrawCard) {
        handlePlaceRevealedWithSlide(targetPlayerId)
      }
      return
    }

    if (draggedCardIndex === null) {
      return
    }
    if (!isMyTurn) {
      setDraggedCardIndex(null)
      return
    }

    if (payload.state.phase === 'DEALING') {
      if (payload.state.revealedDrawCard) {
        handlePlaceRevealedWithSlide(targetPlayerId)
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

  async function copyInviteLink(): Promise<void> {
    if (!roomCode) {
      return
    }
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setInviteCopied(true)
      window.setTimeout(() => setInviteCopied(false), 2000)
    } catch {
      setError('Nepavyko nukopijuoti nuorodos')
    }
  }

  function handleSeatClick(targetPlayerId: string): void {
    if (!payload || !isMyTurn) {
      return
    }
    if (payload.state.phase !== 'DEALING' || !payload.state.revealedDrawCard) {
      return
    }
    handlePlaceRevealedWithSlide(targetPlayerId)
  }

  function animateRemoteAction(info: ActionAnimatedEvent): void {
    if (!info.card) {
      return
    }

    const centerArea = centerDropRef.current
    const seatOf = (id: string | null): HTMLElement | null => (id ? tableSeatRefs.current.get(id) ?? null : null)
    const cardOfSeat = (seat: HTMLElement | null): HTMLElement | null =>
      (seat?.querySelector('.seatTopCard') as HTMLElement | null) ?? seat

    let source: HTMLElement | null = null
    let target: HTMLElement | null = null

    if (info.actionType === 'PLACE_REVEALED') {
      source = (centerArea?.querySelector('.deckRevealAnim .playingCard') as HTMLElement | null) ?? centerArea
      target = cardOfSeat(seatOf(info.toPlayerId))
    } else if (info.actionType === 'MOVE_VISIBLE_CARD') {
      source = cardOfSeat(seatOf(info.actorPlayerId))
      target = cardOfSeat(seatOf(info.toPlayerId))
    } else if (info.actionType === 'PLAY_CARD') {
      source = cardOfSeat(seatOf(info.actorPlayerId))
      target = centerArea
    } else if (info.actionType === 'TAKE_OLDEST') {
      source = centerArea
      target = cardOfSeat(seatOf(info.actorPlayerId))
    } else {
      return
    }

    if (!source || !target) {
      return
    }

    const sourceRect = source.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    if (!sourceRect.width || !targetRect.width) {
      return
    }

    const fly = {
      card: info.card,
      fromX: sourceRect.left,
      fromY: sourceRect.top,
      toX: targetRect.left + (targetRect.width - sourceRect.width) / 2,
      toY: targetRect.top + (targetRect.height - sourceRect.height) / 2,
      width: sourceRect.width,
      height: sourceRect.height,
    }

    if (info.actionType === 'PLAY_CARD') {
      setFlyingPlayedCard(fly)
      window.setTimeout(() => setFlyingPlayedCard(null), 330)
    } else {
      setFlyingRevealedCard(fly)
      window.setTimeout(() => setFlyingRevealedCard(null), 330)
    }
  }

  function handlePlaceRevealedWithSlide(targetPlayerId: string): void {
    if (!payload || !isMyTurn) {
      return
    }
    if (payload.state.phase !== 'DEALING' || !payload.state.revealedDrawCard) {
      return
    }
    if (flyingRevealedCard || flyingPlayedCard) {
      return
    }

    const centerArea = centerDropRef.current
    const targetSeat = tableSeatRefs.current.get(targetPlayerId) ?? null
    const source = (centerArea?.querySelector('.deckRevealAnim .playingCard') as HTMLElement | null) ?? centerArea
    const target = (targetSeat?.querySelector('.seatTopCard') as HTMLElement | null) ?? targetSeat

    if (!source || !target) {
      sendAction({ type: 'PLACE_REVEALED', toPlayerId: targetPlayerId })
      return
    }

    const sourceRect = source.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const toX = targetRect.left + (targetRect.width - sourceRect.width) / 2
    const toY = targetRect.top + (targetRect.height - sourceRect.height) / 2

    setFlyingRevealedCard({
      card: payload.state.revealedDrawCard,
      fromX: sourceRect.left,
      fromY: sourceRect.top,
      toX,
      toY,
      width: sourceRect.width,
      height: sourceRect.height,
    })

    window.setTimeout(() => {
      sendAction({ type: 'PLACE_REVEALED', toPlayerId: targetPlayerId })
      setFlyingRevealedCard(null)
    }, 330)
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

  function handlePlayCardWithSlide(index: number, card: Card, sourceElement?: HTMLElement | null): void {
    if (!isMyTurn || flyingPlayedCard) {
      return
    }

    const source = sourceElement ?? playingCardButtonRefs.current.get(index) ?? null
    const target = centerDropRef.current
    if (!source || !target) {
      sendAction({ type: 'PLAY_CARD', cardIndex: index })
      return
    }

    const sourceRect = source.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const toX = targetRect.left + (targetRect.width - sourceRect.width) / 2
    const toY = targetRect.top + (targetRect.height - sourceRect.height) / 2

    setFlyingPlayedCard({
      card,
      fromX: sourceRect.left,
      fromY: sourceRect.top,
      toX,
      toY,
      width: sourceRect.width,
      height: sourceRect.height,
    })

    window.setTimeout(() => {
      sendAction({ type: 'PLAY_CARD', cardIndex: index })
      setFlyingPlayedCard(null)
    }, 330)
  }

  function renderVisualCard(card: Card, compact = false) {
    return (
      <div className={compact ? `playingCard compact ${cardColorClass(card.suit)}` : `playingCard ${cardColorClass(card.suit)}`}>
        <span className="corner top"><span>{card.rank}</span>{renderSuitGlyph(card.suit)}</span>
        <span className="centerSuit">{renderSuitGlyph(card.suit)}</span>
        <span className="corner bottom"><span>{card.rank}</span>{renderSuitGlyph(card.suit)}</span>
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
            disabled={!isMyTurn || !selectedTargetId || payload.state.revealedDrawCard === null || Boolean(flyingRevealedCard)}
            onClick={() => handlePlaceRevealedWithSlide(selectedTargetId)}
          >
            Padeti atversta korta pasirinktam
          </button>
          <button
            disabled={!isMyTurn || payload.state.revealedDrawCard === null || Boolean(flyingRevealedCard)}
            onClick={() => handlePlaceRevealedWithSlide(payload.yourPlayerId)}
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

  function renderProfileBadge(
    profile: PlayerProfile,
    compact = false,
    displayName?: string,
    options?: { onClick?: () => void; isFlipping?: boolean },
  ) {
    const avatarRarity = AVATAR_RARITY[profile.avatarId]
    const unlockGames = RARITY_GAMES_REQUIRED[avatarRarity]
    const tierLabel = RARITY_LABELS[avatarRarity]
    const rarityCost = itemCost('avatar', profile.avatarId)
    const style = {
      '--profile-accent': profile.baseColor,
      '--profile-accent-soft': hexToRgba(profile.baseColor, compact ? 0.2 : 0.28),
    } as CSSProperties

    const avatarArtClass = AVATAR_ART_CLASS[profile.avatarId]
    const badgeClass = compact
      ? `profileBadge compact fx-${profile.effectId} avatar-${profile.avatarId} avatar-art-${avatarArtClass} has-avatar-art bg-${profile.cardBackgroundId}${options?.isFlipping ? ' is-flipping' : ''}${options?.onClick ? ' is-clickable' : ''}`
      : `profileBadge fx-${profile.effectId} avatar-${profile.avatarId} avatar-art-${avatarArtClass} has-avatar-art bg-${profile.cardBackgroundId}${options?.isFlipping ? ' is-flipping' : ''}${options?.onClick ? ' is-clickable' : ''}`

    const isInteractive = Boolean(options?.onClick)

    return (
      <div
        className={badgeClass}
        style={style}
        onClick={options?.onClick}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onKeyDown={
          isInteractive
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  options?.onClick?.()
                }
              }
            : undefined
        }
      >
        <div className="profileCardHeader">
          <span className={`profileCardTier tier-${profile.effectId} rarity-${avatarRarity}`}>{tierLabel}</span>
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
          <div className="avatarArtwork" aria-hidden="true" />
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
              {profile.avatarId === 'mage' ? (
                <>
                  <span className="avatarWizardHat" />
                  <span className="avatarCrownMark" />
                  <span className="avatarWizardRune" />
                  <span className="avatarWizardBeard" />
                </>
              ) : null}
              {profile.avatarId === 'warrior' ? (
                <>
                  <span className="avatarWarriorHelm" />
                  <span className="avatarWarriorMask" />
                  <span className="avatarWarriorCrest" />
                </>
              ) : null}
              {profile.avatarId === 'ronin' ? <span className="avatarRoninTopknot" /> : null}
              {profile.avatarId === 'guardian' ? <span className="avatarGuardianMark" /> : null}
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
        </div>

        <div className="profileCardName">{displayName?.trim() || 'Zaidejas'}</div>

        <div className="profileCardTags">
          <span className={`profileCardTag rarity rarity-${avatarRarity}`}>{tierLabel}</span>
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

  function renderFlippableCard(
    profile: PlayerProfile,
    compact: boolean,
    displayName: string | undefined,
    playerId: string,
  ) {
    const isFlipped = flippedBadgeId === playerId
    const isOwnCard = playerId === payload?.yourPlayerId || playerId === 'own'
    const localInfo: PlayerCardInfo = {
      playerName: displayName?.trim() || me?.name || name || 'Zaidejas',
      registeredAt: account.registeredAt,
      gamesPlayed: account.gamesPlayed,
      gamesWon: account.gamesWon,
      gamesLost: account.gamesLost,
      level: calcLevel(account.gamesPlayed),
    }
    const info = playerCardInfoCache[playerId] ?? (isOwnCard ? localInfo : undefined)
    const isLoading = loadingCardInfoId === playerId
    const achievements = info ? buildPlayerAchievements(info) : []
    const visibleAchievements = compact ? achievements.slice(0, 2) : achievements.slice(0, 3)
    const unlockedAchievementClasses = achievements
      .filter((achievement) => achievement.unlocked)
      .map((achievement) => `has-achievement-${achievement.id}`)
      .join(' ')
    const isVip = (info?.level ?? 0) >= 20

    const formatDate = (ts: number) => {
      return new Date(ts).toLocaleDateString('lt-LT', { year: 'numeric', month: 'short', day: 'numeric' })
    }

    const applyTiltFromPoint = (element: HTMLDivElement, clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        return
      }

      const x = (clientX - rect.left) / rect.width - 0.5
      const y = (clientY - rect.top) / rect.height - 0.5
      const tiltX = Number((-y * 10).toFixed(2))
      const tiltY = Number((x * 12).toFixed(2))

      element.style.setProperty('--tilt-x', `${tiltX}deg`)
      element.style.setProperty('--tilt-y', `${tiltY}deg`)
    }

    const resetTilt = (element: HTMLDivElement) => {
      element.style.setProperty('--tilt-x', '0deg')
      element.style.setProperty('--tilt-y', '0deg')
    }

    const handleCardMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      applyTiltFromPoint(element, event.clientX, event.clientY)
    }

    const handleCardTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      applyTiltFromPoint(element, touch.clientX, touch.clientY)
    }

    const handleCardTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      applyTiltFromPoint(element, touch.clientX, touch.clientY)
    }

    const handleCardMouseLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      resetTilt(element)
    }

    const handleCardTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      resetTilt(element)
    }

    const effectClass = `effect-${profile.effectId}`
    const vipClass = isVip ? 'vip-card' : ''
    const flipCardClass = compact
      ? (isFlipped
        ? `flipCard compact flipped ${effectClass} ${vipClass} ${unlockedAchievementClasses}`
        : `flipCard compact ${effectClass} ${vipClass} ${unlockedAchievementClasses}`)
      : (isFlipped
        ? `flipCard flipped ${effectClass} ${vipClass} ${unlockedAchievementClasses}`
        : `flipCard ${effectClass} ${vipClass} ${unlockedAchievementClasses}`)

    return (
      <div
        key={`flip-${playerId}`}
        className={flipCardClass}
        onClick={(event) => handleBadgeFlip(playerId, event)}
        onMouseMove={handleCardMouseMove}
        onMouseLeave={handleCardMouseLeave}
        onTouchStart={handleCardTouchStart}
        onTouchMove={handleCardTouchMove}
        onTouchEnd={handleCardTouchEnd}
        onTouchCancel={handleCardTouchEnd}
        ref={isFlipped ? (el) => { (flipContainerRef as any).current = el } : null}
      >
        <div className="flipCardInner">
          <div className="flipCardFront">
            {renderProfileBadge(profile, compact, displayName)}
          </div>
          <div className="flipCardBack">
            {isLoading ? (
              <div className="cardBackLoading"><span className="cardBackSpinner" /></div>
            ) : info ? (
              <div className="cardBackContent">
                <div className="cardBackTop">
                  <div className="cardBackBrand" data-text="FASIOLAS" aria-label="Fasiolas brand">FASIOLAS</div>
                </div>
                <div className="cardBackBody">
                  <div className="cardBackCoin" aria-label="Fasiolas coin">
                    <span className="cardBackCoinCore">F</span>
                  </div>
                  <div className="cardBackTitle">{info.playerName}</div>
                  <div className="cardBackLevel">
                    <span className="cardBackLevelNum">Lv. {info.level}</span>
                    <span className="cardBackLevelSub">Lygio intervalas: {(info.level - 1) * 5}–{info.level * 5 - 1} suzaista</span>
                  </div>
                  <div className="cardBackStats">
                    <div className="cardBackStat">
                      <span className="cardBackStatVal">{info.gamesPlayed}</span>
                      <span className="cardBackStatLabel">Suzaista</span>
                    </div>
                    <div className="cardBackStat win">
                      <span className="cardBackStatVal">{info.gamesWon}</span>
                      <span className="cardBackStatLabel">Laimeta</span>
                    </div>
                  </div>
                  <div className="cardBackAchievements" aria-label="Achievements">
                    {visibleAchievements.map((achievement) => (
                      <span
                        key={achievement.id}
                        className={achievement.unlocked
                          ? `cardBackAchievement vip unlocked achievement-${achievement.id}`
                          : `cardBackAchievement vip locked achievement-${achievement.id}`}
                      >
                        {achievement.title}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="cardBackFooter">
                  <div className="cardBackEdition">VIP SPECIAL EDITION</div>
                  {isVip ? <div className="cardBackVip">VIP LEVEL</div> : null}
                  <div className="cardBackRegistered">Registracijos data: {formatDate(info.registeredAt)}</div>
                </div>
              </div>
            ) : (
              <div className="cardBackContent">
                <div className="cardBackTop">
                  <div className="cardBackBrand" data-text="FASIOLAS" aria-label="Fasiolas brand">FASIOLAS</div>
                </div>
                <div className="cardBackBody">
                  <div className="cardBackCoin" aria-label="Fasiolas coin">
                    <span className="cardBackCoinCore">F</span>
                  </div>
                  <div className="cardBackTitle">{displayName ?? 'Zaidejas'}</div>
                  <div className="cardBackNoData">Duomenys nepasiekiami</div>
                </div>
                <div className="cardBackFooter">
                  <div className="cardBackEdition">VIP SPECIAL EDITION</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  async function handleLogin(): Promise<void> {
    const email = loginUsername.trim().toLowerCase()
    const password = loginPassword.trim()
    setLoginInfo('')

    if (!email || !password) {
      setLoginError('Ivesk el. pasta arba varda ir slaptazodi')
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = (await response.json()) as ({ ok: boolean; error?: string } & Partial<AuthBootstrapPayload>)
      if (!response.ok || !payload.ok || !payload.email || !payload.activeProfileSlot || !payload.profileSlots || !payload.account) {
        setLoginError(payload.error ?? 'Prisijungti nepavyko')
        return
      }

      applyAuthBootstrap(payload as AuthBootstrapPayload)
    } catch {
      setLoginError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
    }
  }

  async function handleRegister(): Promise<void> {
    const email = loginUsername.trim().toLowerCase()
    const password = loginPassword.trim()
    const confirm = registerConfirmPassword.trim()
    const playerName = registerPlayerName.trim()

    if (!email || !password) {
      setLoginInfo('')
      setLoginError('Ivesk el. pasta ir slaptazodi registracijai')
      return
    }
    if (password.length < 8) {
      setLoginInfo('')
      setLoginError('Slaptazodis turi buti bent 8 simboliu')
      return
    }
    if (password !== confirm) {
      setLoginInfo('')
      setLoginError('Slaptazodziai nesutampa')
      return
    }
    if (!playerName) {
      setLoginInfo('')
      setLoginError('Ivesk zaidimo varda')
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, playerName }),
      })
      const payload = (await response.json()) as {
        ok: boolean
        error?: string
        message?: string
        userId?: string
        playerName?: string
      }

      if (!response.ok || !payload.ok) {
        setLoginInfo('')
        setLoginError(payload.error ?? 'Registracija nepavyko')
        return
      }

      setLoginError('')
      if (payload.userId) {
        sessionStorage.setItem(AUTH_USER_ID_STORAGE_KEY, payload.userId)
      }
      setLoginInfo(payload.message ?? 'Registracija sekminga. Dabar galite prisijungti.')
      setName(payload.playerName?.trim() || playerName)
      setAuthMode('login')
    } catch {
      setLoginInfo('')
      setLoginError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
    }
  }

  async function handleForgotPassword(): Promise<void> {
    const email = loginUsername.trim().toLowerCase()
    setLoginError('')
    setLoginInfo('')

    if (!email) {
      setLoginError('Ivesk el. pasta')
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const payload = (await response.json()) as {
        ok: boolean
        message?: string
        error?: string
        previewResetLink?: string
      }

      if (!response.ok || !payload.ok) {
        setLoginError(payload.error ?? 'Nepavyko issiusti reset nuorodos')
        return
      }

      setLoginInfo(
        payload.previewResetLink
          ? `${payload.message ?? ''} Reset nuoroda: ${payload.previewResetLink}`
          : payload.message ?? 'Jei email egzistuoja, nuoroda issiusta.',
      )
    } catch {
      setLoginError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
    }
  }

  async function handleResetPassword(): Promise<void> {
    const password = loginPassword.trim()
    const confirm = confirmPassword.trim()

    setLoginError('')
    setLoginInfo('')

    if (!resetToken) {
      setLoginError('Nerastas reset tokenas')
      return
    }
    if (password.length < 8) {
      setLoginError('Slaptazodis turi buti bent 8 simboliu')
      return
    }
    if (password !== confirm) {
      setLoginError('Slaptazodziai nesutampa')
      return
    }

    try {
      const response = await fetch(`${SERVER_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      })
      const payload = (await response.json()) as { ok: boolean; error?: string; message?: string }
      if (!response.ok || !payload.ok) {
        setLoginError(payload.error ?? 'Nepavyko atnaujinti slaptazodzio')
        return
      }

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        params.delete(RESET_TOKEN_QUERY_KEY)
        const nextQuery = params.toString()
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
        window.history.replaceState({}, '', nextUrl)
      }

      setResetToken('')
      setConfirmPassword('')
      setLoginPassword('')
      setAuthMode('login')
      setLoginInfo(payload.message ?? 'Slaptazodis pakeistas. Dabar galite prisijungti.')
    } catch {
      setLoginError('Serveris nepasiekiamas. Patikrink ar paleistas backend.')
    }
  }

  function handleLogout(): void {
    sessionStorage.removeItem(LOGIN_SESSION_STORAGE_KEY)
    setAuthEmail('')
    setAppStage('auth')
    sessionStorage.removeItem(AUTH_USER_ID_STORAGE_KEY)
    setLoginPassword('')
    setLoginError('')
    setLoginInfo('')
    setPayload(null)
    setRoomCode('')
    setRoomCodeInput('')
    setShowTableWindow(false)
    setShowMarketplaceWindow(false)
  }

  function returnToMainMenu(): void {
    const activeRoomCode = payload?.state.roomCode ?? roomCode
    if (activeRoomCode) {
      sessionStorage.removeItem(playerStorageKey(activeRoomCode))
    }

    setError('')
    setPayload(null)
    setRoomCode('')
    setRoomCodeInput('')
    setShowTableWindow(false)
    setShowMarketplaceWindow(false)
    setDraggedCardIndex(null)
    setSelectedTargetId('')
  }

  if (appStage === 'loading') {
    return (
      <div className="page">
        <section className="panel loginPanel">
          <h1>Kraunama paskyra</h1>
          <p className="loginHint">Atkuriame tavo profili, kosmetikas ir paskyros busena.</p>
        </section>
      </div>
    )
  }

  if (appStage === 'auth') {
    return (
      <div className="page authPage">
        <section className="panel loginPanel">
          <h1>Prisijungimas</h1>
          <p className="loginHint">Prisijungti gali el. pastu arba zaidimo vardu. El. pastas reikalingas slaptazodzio atstatymui.</p>
          <div className="row">
            <label htmlFor="login-name">{authMode === 'login' ? 'El. pastas arba vardas' : 'El. pastas'}</label>
            <input
              id="login-name"
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              placeholder={authMode === 'login' ? 'Ivesk el. pasta arba zaidimo varda' : 'Ivesk el. pasta'}
            />
          </div>
          {authMode !== 'forgot' ? (
            <div className="row">
              <label htmlFor="login-password">Slaptazodis</label>
              <input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder={authMode === 'reset' ? 'Naujas slaptazodis' : 'Ivesk slaptazodi'}
              />
            </div>
          ) : null}
          {authMode === 'register' ? (
            <>
              <div className="row">
                <label htmlFor="register-confirm-password">Pakartok slaptazodi</label>
                <input
                  id="register-confirm-password"
                  type="password"
                  value={registerConfirmPassword}
                  onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                  placeholder="Pakartok slaptazodi"
                />
              </div>
              <div className="row">
                <label htmlFor="register-player-name">Zaidimo vardas</label>
                <input
                  id="register-player-name"
                  value={registerPlayerName}
                  onChange={(event) => setRegisterPlayerName(event.target.value)}
                  placeholder="Ivesk zaidimo varda"
                />
              </div>
            </>
          ) : null}
          {authMode === 'reset' ? (
            <div className="row">
              <label htmlFor="confirm-password">Pakartok slaptazodi</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Pakartok slaptazodi"
              />
            </div>
          ) : null}
          <div className="actions">
            {authMode === 'login' ? <button type="button" onClick={handleLogin}>Prisijungti</button> : null}
            {authMode === 'register' ? <button type="button" onClick={handleRegister}>Registruotis</button> : null}
            {authMode === 'forgot' ? <button type="button" onClick={handleForgotPassword}>Siusti reset nuoroda</button> : null}
            {authMode === 'reset' ? <button type="button" onClick={handleResetPassword}>Atnaujinti slaptazodi</button> : null}

            {authMode !== 'register' ? (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register')
                  setRegisterConfirmPassword('')
                  setRegisterPlayerName('')
                  setLoginInfo('')
                  setLoginError('')
                }}
              >
                Kurti paskyra
              </button>
            ) : null}
            {authMode !== 'forgot' ? (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('forgot')
                  setLoginPassword('')
                  setConfirmPassword('')
                  setLoginInfo('')
                  setLoginError('')
                }}
              >
                Pamirsau slaptazodi
              </button>
            ) : null}
            {authMode !== 'login' ? (
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login')
                  setRegisterConfirmPassword('')
                  setRegisterPlayerName('')
                  setConfirmPassword('')
                  setLoginInfo('')
                  setLoginError('')
                }}
              >
                Grizti i prisijungima
              </button>
            ) : null}
          </div>
          {loginInfo ? <div className="success">{loginInfo}</div> : null}
          {loginError ? <div className="error">{loginError}</div> : null}
        </section>
      </div>
    )
  }

  if (appStage === 'profileSetup') {
    const commonAvatars = AVATAR_OPTIONS.filter((avatar) => AVATAR_RARITY[avatar] === 'common')
    const currentAvatarIndex = Math.max(0, commonAvatars.indexOf(profileDraft.avatarId))
    const cycleSetupAvatar = (direction: -1 | 1): void => {
      if (commonAvatars.length === 0) {
        return
      }
      const nextAvatar = commonAvatars[(currentAvatarIndex + direction + commonAvatars.length) % commonAvatars.length]
      updateProfileDraft((current) => ({ ...current, avatarId: nextAvatar }))
    }

    return (
      <div className="page profileOnboardingPage">
        <section className="profileOnboarding">
          <header className="profileOnboardingHeader">
            <h1>Pasirink savo veikeja</h1>
          </header>

          <div className="profileOnboardingStage">
            <button type="button" className="onboardingArrow" aria-label="Ankstesnis veikejas" onClick={() => cycleSetupAvatar(-1)}>&#8249;</button>
            <div className="profileOnboardingCard">
              {renderProfileBadge(profileDraft, false, name || displayNameFromEmail(authEmail))}
            </div>
            <button type="button" className="onboardingArrow" aria-label="Kitas veikejas" onClick={() => cycleSetupAvatar(1)}>&#8250;</button>
          </div>

          <div className="profileOnboardingAvatarName">{AVATAR_LABELS[profileDraft.avatarId]}</div>

          <button type="button" className="profileOnboardingConfirm" onClick={() => { void completeProfileSetup() }}>
            Testi i zaidimo centra
          </button>
          {error ? <div className="error">{error}</div> : null}
        </section>
      </div>
    )
  }

  return (
    <div className="page mainMenuPage">
      <header>
        <div className="headerRow">
          <h1 className="mainMenuAnimatedTitle">FASIOLAS</h1>
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
          <button type="button" disabled={!roomCode} onClick={() => { void copyInviteLink() }}>
            {inviteCopied ? 'Nukopijuota!' : 'Kopijuoti kvietima'}
          </button>
          {payload?.state.phase === 'LOBBY' ? (
            <button type="button" onClick={() => emitAck('add_bot', {})}>
              Iskviesti bota
            </button>
          ) : null}
          <button type="button" onClick={() => setShowMarketplaceWindow(true)}>
            Marketplace
          </button>
          <button type="button" onClick={() => setShowLeaderboard(true)}>
            Lyderiu lentele
          </button>
        </div>

        <div className="profileQuickPanel">
          <div className="profileQuickInfo">
            <strong>Profilio langelis</strong>
            <span>Slotas {activeProfileSlot} | Lv. {accountLevel} | W {account.gamesWon} / L {account.gamesLost} | Total {account.gamesPlayed}</span>
            <div className="levelProgressWrap" aria-label="Lygio progresas">
              <div className="levelProgressTrack">
                <div className="levelProgressFill" style={{ width: `${Math.round(accountLevelProgress * 100)}%` }} />
              </div>
              <span className="levelProgressText">Iki kito lygio: {accountLevelGamesLeft} game</span>
            </div>
          </div>
          {payload && payload.state.phase === 'LOBBY' ? (
            <div className="lobbyPlayersRow" aria-label="Prisijunge zaidejai">
              {payload.state.players.map((p) => (
                <div key={`lobby-player-${p.id}`} className="lobbyPlayerCard">
                  {renderFlippableCard(p.profile, true, p.name, p.id)}
                </div>
              ))}
            </div>
          ) : (
            renderFlippableCard(profilePanelProfile, true, name || me?.name, payload?.yourPlayerId ?? 'own')
          )}
          <div className="actions">
            <button type="button" onClick={() => setAppStage('profileSetup')}>Keisti veikeja</button>
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>

      {showMarketplaceWindow ? (
        <section className="profileWindowOverlay" role="dialog" aria-modal="true" aria-label="Marketplace">
          <article className="profileWindow panel marketplaceWindow">
            <div className="profileWindowHeader">
              <h2>Marketplace</h2>
              <button type="button" onClick={() => { setShowMarketplaceWindow(false); void saveProfile() }}>Uzdaryti</button>
            </div>

            <div className="profileWindowBody marketplaceBody">
              <div className="loadoutStage">
                {renderProfileBadge(profilePanelProfile, true, profilePanelDisplayName)}
              </div>

              <div className="customizationPanel">
                {renderMarketplacePanel('Marketplace', 'Registracija: +250 pts. Kiekvienas match: +200 tasku visiems, Top3 bonusai: +200 / +100 / +50.')}

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
          </article>
        </section>
      ) : null}

      {showLeaderboard ? (
        <section className="profileWindowOverlay" role="dialog" aria-modal="true" aria-label="Lyderiu lentele">
          <article className="profileWindow panel leaderboardWindow">
            <div className="profileWindowHeader">
              <h2>Lyderiu lentele</h2>
              <button type="button" onClick={() => setShowLeaderboard(false)}>Uzdaryti</button>
            </div>
            <div className="profileWindowBody leaderboardBody">
              {leaderboardLoading && leaderboard.length === 0 ? (
                <p className="leaderboardHint">Kraunama...</p>
              ) : leaderboard.length === 0 ? (
                <p className="leaderboardHint">Dar nera zaideju.</p>
              ) : (
                <table className="leaderboardTable">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Zaidejas</th>
                      <th>Lv.</th>
                      <th>Taskai</th>
                      <th>W</th>
                      <th>L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, index) => (
                      <tr
                        key={`${entry.playerName}-${index}`}
                        className={entry.playerName === (name || me?.name) ? 'leaderboardSelf' : undefined}
                      >
                        <td>{index + 1}</td>
                        <td>{entry.playerName}</td>
                        <td>{entry.level}</td>
                        <td>{entry.points}</td>
                        <td>{entry.gamesWon}</td>
                        <td>{entry.gamesLost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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

            <div className={`roundTableArea table-${me?.profile.tableId ?? 'common_green'}`}>
              {payload.state.phase === 'DEALING' ? (
                <div className="fasiolasDock">
                  <strong>Fasiolas</strong>
                  <div className="fasiolasButtons">
                    {payload.state.players
                      .filter((p) => p.id !== payload.yourPlayerId)
                      .map((p) => (
                        <button
                          key={`dock-${p.id}`}
                          disabled={Boolean(payload.state.pendingFasiolas)}
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
                        disabled={!isMyTurn || Boolean(flyingPlayedCard)}
                        onClick={(event) => handlePlayCardWithSlide(index, card, event.currentTarget)}
                        ref={(element) => {
                          if (!element) {
                            playingCardButtonRefs.current.delete(index)
                            return
                          }
                          playingCardButtonRefs.current.set(index, element)
                        }}
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
                ref={centerDropRef}
                className={
                  payload.state.phase === 'DEALING'
                    ? 'roundTableCenter dealingCenter'
                    : draggedCardIndex !== null && payload.state.phase === 'PLAYING'
                      ? 'roundTableCenter dropTarget'
                      : 'roundTableCenter'
                }
                onDragOver={allowDrop}
                onDrop={handleCenterDrop}
              >
                {payload.state.phase === 'DEALING' ? (
                  <div className="centerDeckArea">
                    <button
                      type="button"
                      className={canDrawFromCenterDeck ? 'centerDeckWrap deckClickable' : 'centerDeckWrap deckInactive'}
                      onClick={drawFromCenterDeck}
                    >
                      <div className="deckShadow">{renderCardBack()}</div>
                      <div className="deckFront">{renderCardBack()}</div>
                      <span className="deckCount">Kalade: {payload.state.centerDeckCount}</span>
                      <span className="deckHint">{deckStatusText}</span>
                    </button>
                    {payload.state.revealedDrawCard ? (
                      <div
                        className={isMyTurn && !flyingRevealedCard ? 'deckRevealOverlay draggableCard' : 'deckRevealOverlay'}
                        draggable={isMyTurn && !flyingRevealedCard}
                        onDragStart={(event) => {
                          event.dataTransfer?.setData('text/plain', 'revealed-card')
                          setIsRevealedCardDragged(true)
                        }}
                        onDragEnd={() => setIsRevealedCardDragged(false)}
                      >
                        <div className="deckRevealAnim" key={cardLabel(payload.state.revealedDrawCard)}>
                          {renderVisualCard(payload.state.revealedDrawCard)}
                        </div>
                      </div>
                    ) : null}
                  </div>
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

              {flyingPlayedCard ? (
                <div
                  className="flyingPlayedCard"
                  style={{
                    '--fly-from-x': `${flyingPlayedCard.fromX}px`,
                    '--fly-from-y': `${flyingPlayedCard.fromY}px`,
                    '--fly-to-x': `${flyingPlayedCard.toX}px`,
                    '--fly-to-y': `${flyingPlayedCard.toY}px`,
                    '--fly-width': `${flyingPlayedCard.width}px`,
                    '--fly-height': `${flyingPlayedCard.height}px`,
                  } as CSSProperties}
                >
                  {renderVisualCard(flyingPlayedCard.card, true)}
                </div>
              ) : null}

              {flyingRevealedCard ? (
                <div
                  className="flyingRevealedCard"
                  style={{
                    '--fly-from-x': `${flyingRevealedCard.fromX}px`,
                    '--fly-from-y': `${flyingRevealedCard.fromY}px`,
                    '--fly-to-x': `${flyingRevealedCard.toX}px`,
                    '--fly-to-y': `${flyingRevealedCard.toY}px`,
                    '--fly-width': `${flyingRevealedCard.width}px`,
                    '--fly-height': `${flyingRevealedCard.height}px`,
                  } as CSSProperties}
                >
                  {renderVisualCard(flyingRevealedCard.card)}
                </div>
              ) : null}

              {tableSeats.map((seat) => (
                <div
                  key={seat.id}
                  ref={(element) => {
                    if (!element) {
                      tableSeatRefs.current.delete(seat.id)
                      return
                    }
                    tableSeatRefs.current.set(seat.id, element)
                  }}
                  className={[
                    'tableSeat',
                    seat.isMe ? 'me' : '',
                    (draggedCardIndex !== null || isRevealedCardDragged) && payload.state.phase === 'DEALING' && isMyTurn ? 'dropTarget' : '',
                    seat.id === payload.state.currentTurnPlayerId ? 'activeTurn' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
                  onDragOver={allowDrop}
                  onDrop={() => handleSeatDrop(seat.id)}
                  onClick={() => handleSeatClick(seat.id)}
                >
                  <div className="seatIdentity">
                    <div className={seat.isMe ? 'seatIdentityRow meSeatIdentityRow' : 'seatIdentityRow opponentSeatIdentityRow'}>
                      {renderFlippableCard(seat.profile, true, seat.name, seat.id)}
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

      {payload && payload.state.phase !== 'LOBBY' ? (
        <>
          <section className="panel status">
            <div>Kambarys: {payload.state.roomCode}</div>
            <div>Faze: {payload.state.phase}</div>
            <div>Tavo id: {payload.yourPlayerId.slice(0, 8)}</div>
            <div>Eile: {payload.state.currentTurnPlayerId?.slice(0, 8) ?? '-'}</div>
            <div>Kozeris: {payload.state.trumpSuit ?? 'none'}</div>
            <div>Kalades viduryje: {payload.state.centerDeckCount}</div>
            {me ? <div className="statusProfile">{renderFlippableCard(me.profile, true, me.name, payload.yourPlayerId)}</div> : null}
          </section>

          <section className="panel">
            <h2>Zaideju langelis</h2>
            <div className="players">
              {payload.state.players.map((p) => (
                <article key={p.id} className={p.id === payload.yourPlayerId ? 'player me' : 'player'}>
                  {renderFlippableCard(p.profile, true, p.name, p.id)}
                  <strong>{p.name}</strong>
                  <span>ID: {p.id.slice(0, 8)}</span>
                  <span>Kortos: {p.cardCount}</span>
                  <span>Virsus: {cardLabel(p.topCard)}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Zaideju statistika</h2>
            <div className="statsTableWrap">
              <table className="statsTable" aria-label="Zaideju statistikos lentele">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Zaidejas</th>
                    <th>Lvl</th>
                    <th>Laimeta</th>
                    <th>Pralaimeta</th>
                    <th>Total</th>
                    <th>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {statsLeaderboard.map((row, index) => (
                    <tr key={`stat-row-${row.playerId}`} className={row.playerId === payload.yourPlayerId ? 'me' : ''}>
                      <td>{index + 1}</td>
                      <td>{row.playerName}</td>
                      <td>{row.level}</td>
                      <td>{row.gamesWon}</td>
                      <td>{row.gamesLost}</td>
                      <td>{row.gamesPlayed}</td>
                      <td>{row.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      onClick={(event) => {
                        if (payload.state.phase !== 'PLAYING') {
                          return
                        }
                        handlePlayCardWithSlide(i, c, event.currentTarget)
                      }}
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
          {payload.state.matchRewards?.find((entry) => entry.playerId === me.id)?.won ? (
            <div className="confettiLayer" aria-hidden="true">
              {Array.from({ length: 28 }).map((_, i) => (
                <span
                  key={`confetti-${i}`}
                  className="confettiPiece"
                  style={{
                    left: `${(i * 37) % 100}%`,
                    animationDelay: `${(i % 7) * 0.35}s`,
                    animationDuration: `${2.6 + (i % 5) * 0.45}s`,
                    backgroundColor: ['#ffd54f', '#ff5e5e', '#53dc5b', '#338bff', '#c084fc'][i % 5],
                  }}
                />
              ))}
            </div>
          ) : null}
          <article className="resultsDialog">
            <h2>
              {payload.state.matchRewards?.find((entry) => entry.playerId === me.id)?.won
                ? 'Laimejai partija!'
                : payload.state.loserPlayerId === me.id
                  ? 'Pralaimejai partija'
                  : 'Partija baigta'}
            </h2>
            <p className="resultsSubtitle">Galutiniai zaidimo rezultatai</p>

            <div className="resultsTableWrap">
              <table className="resultsTable">
                <thead>
                  <tr>
                    <th>Vieta</th>
                    <th>Zaidejas</th>
                    <th>Statusas</th>
                    <th>Taskai</th>
                  </tr>
                </thead>
                <tbody>
                  {finalStandings.map((player, index) => {
                    const rewardEntry = payload.state.matchRewards?.find((entry) => entry.playerId === player.id)
                    const rowClasses = [
                      index === 0 ? 'winnerRow' : '',
                      player.id === me.id ? 'selfRow' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <tr key={`result-${player.id}`} className={rowClasses}>
                        <td>#{rewardEntry?.placement ?? index + 1}</td>
                        <td>{player.name}</td>
                        <td>{payload.state.loserPlayerId === player.id ? 'Pralaimejo' : 'Laimetojas'}</td>
                        <td className="rewardCell">{rewardEntry ? `+${rewardEntry.reward}` : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="resultsActions">
              <button type="button" onClick={returnToMainMenu}>Grizti i main menu</button>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  )
}

export default App
