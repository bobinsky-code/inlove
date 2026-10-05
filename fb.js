/* Общий слой Firebase: аккаунты, друзья, совместный питомец.
   apiKey здесь не секрет — это публичный идентификатор проекта.
   Данные закрыты правилами Firestore (firestore.rules). */
import { initializeApp } from './vendor/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator,
} from './vendor/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc, writeBatch,
  collection, query, where, onSnapshot, serverTimestamp,
} from './vendor/firebase-firestore.js';

/* локально поднимается эмулятор, на сайте — настоящий проект */
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PROD = {
  apiKey: 'AIzaSyBJXEd_E18fIBLnp_WSk0lFo1Hg-zRgTh4',
  authDomain: 'inlove-83f63.firebaseapp.com',
  projectId: 'inlove-83f63',
  appId: '1:1059697884669:web:123d6191b81a9777faad94',
};
const CFG = LOCAL ? { apiKey: 'emulator', authDomain: 'localhost', projectId: 'demo-inlove', appId: 'emulator' } : PROD;

export const CONFIGURED = !!CFG.projectId;
let auth = null, db = null;
if (CONFIGURED) {
  const app = initializeApp(CFG);
  auth = getAuth(app);
  db = getFirestore(app);
  if (LOCAL) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  setPersistence(auth, browserLocalPersistence).catch(() => { /* останется сессионное хранение */ });
}

/* ---------- логины ---------- */
const DOMAIN = '@inlove.app';
export const LOGIN_RE = /^[A-Za-z0-9_]{3,16}$/;
export const emailOf = (login) => login.toLowerCase() + DOMAIN;
export const loginOf = (user) => (user && user.email ? user.email.slice(0, user.email.indexOf('@')) : '');
const pairId = (a, b) => (a < b ? a + '__' + b : b + '__' + a);
export const petIdOf = pairId;

/* ---------- вход ---------- */
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }
export function authReady() {
  return new Promise((res) => { const off = onAuthStateChanged(auth, (u) => { off(); res(u); }); });
}
export async function register(login, pass) {
  const cred = await createUserWithEmailAndPassword(auth, emailOf(login), pass);
  await ensureProfile(cred.user, login);
  return cred.user;
}
export async function signIn(login, pass) {
  const cred = await signInWithEmailAndPassword(auth, emailOf(login), pass);
  ensureProfile(cred.user).catch(() => { /* профиль допишется при следующем входе */ });
  return cred.user;
}
export function leave() { return signOut(auth); }

/* профиль и запись в справочнике логинов; чинится сам, если первая попытка не дошла */
export async function ensureProfile(user, login) {
  const name = login || loginOf(user), low = name.toLowerCase();
  await setDoc(doc(db, 'users', user.uid), { login: name, loginLower: low }, { merge: true });
  const dir = await getDoc(doc(db, 'logins', low));
  if (!dir.exists()) await setDoc(doc(db, 'logins', low), { uid: user.uid, login: name });
}
export async function loginTaken(login) {
  const s = await getDoc(doc(db, 'logins', login.toLowerCase()));
  return s.exists();
}

/* ---------- друзья ---------- */
export async function sendFriendRequest(me, myLogin, login) {
  const low = login.toLowerCase();
  if (low === myLogin.toLowerCase()) throw new Error('self');
  const dir = await getDoc(doc(db, 'logins', low));
  if (!dir.exists()) throw new Error('nouser');
  const to = dir.data().uid, toLogin = dir.data().login;
  if (await docExists('friendships', pairId(me, to))) throw new Error('already');
  /* встречная заявка — сразу принимаем её */
  const back = await getDoc(doc(db, 'friendRequests', to + '__' + me));
  if (back.exists()) { await acceptFriend(back.data()); return 'friends'; }
  await setDoc(doc(db, 'friendRequests', me + '__' + to), { from: me, fromLogin: myLogin, to, toLogin, created: serverTimestamp() });
  return 'sent';
}
export async function acceptFriend(req) {
  const b = writeBatch(db);
  const names = {}; names[req.from] = req.fromLogin; names[req.to] = req.toLogin;
  b.set(doc(db, 'friendships', pairId(req.from, req.to)), { uids: [req.from, req.to].sort(), names, since: serverTimestamp() });
  b.delete(doc(db, 'friendRequests', req.from + '__' + req.to));
  await b.commit();
}
export function dropFriendRequest(req) { return deleteDoc(doc(db, 'friendRequests', req.from + '__' + req.to)); }

/* ---------- питомец ---------- */
export async function invitePet(me, myLogin, friendUid, friendLogin) {
  if (await docExists('userPet', me)) throw new Error('havepet');
  if (await docExists('userPet', friendUid)) throw new Error('friendhaspet');
  const back = await getDoc(doc(db, 'petInvites', friendUid + '__' + me));
  if (back.exists()) { await acceptPet(back.data()); return 'created'; }
  await setDoc(doc(db, 'petInvites', me + '__' + friendUid), { from: me, fromLogin: myLogin, to: friendUid, toLogin: friendLogin, created: serverTimestamp() });
  return 'sent';
}
export async function acceptPet(inv) {
  const petId = pairId(inv.from, inv.to), b = writeBatch(db);
  const names = {}; names[inv.from] = inv.fromLogin; names[inv.to] = inv.toLogin;
  b.set(doc(db, 'pets', petId), { owners: [inv.from, inv.to].sort(), names, created: serverTimestamp(), state: null, updated: serverTimestamp(), by: inv.to });
  b.set(doc(db, 'userPet', inv.from), { petId, with: inv.to, since: serverTimestamp() });
  b.set(doc(db, 'userPet', inv.to), { petId, with: inv.from, since: serverTimestamp() });
  b.delete(doc(db, 'petInvites', inv.from + '__' + inv.to));
  await b.commit();
  return petId;
}
export function dropPetInvite(inv) { return deleteDoc(doc(db, 'petInvites', inv.from + '__' + inv.to)); }
export function watchMyPet(me, cb) { return onSnapshot(doc(db, 'userPet', me), (s) => cb(s.exists() ? s.data().petId : null), () => cb(null)); }
export async function myPetId(me) {
  const s = await getDoc(doc(db, 'userPet', me));
  return s.exists() ? s.data().petId : null;
}

/* ---------- живые списки лобби ---------- */
export function watchLobby(me, cb) {
  const state = { friends: [], incoming: [], outgoing: [], petIn: [], petOut: [], busy: {} };
  const push = () => cb(state);
  const list = (q, set) => onSnapshot(q, (snap) => { state[set] = snap.docs.map((d) => d.data()); push(); }, () => push());
  const offs = [
    list(query(collection(db, 'friendships'), where('uids', 'array-contains', me)), 'friends'),
    list(query(collection(db, 'friendRequests'), where('to', '==', me)), 'incoming'),
    list(query(collection(db, 'friendRequests'), where('from', '==', me)), 'outgoing'),
    list(query(collection(db, 'petInvites'), where('to', '==', me)), 'petIn'),
    list(query(collection(db, 'petInvites'), where('from', '==', me)), 'petOut'),
  ];
  return () => offs.forEach((off) => off());
}
/* у кого из друзей уже есть питомец — чтобы не предлагать создать */
export async function petOwners(uids) {
  const out = {};
  await Promise.all(uids.map(async (u) => { out[u] = await docExists('userPet', u); }));
  return out;
}

async function docExists(coll, id) {
  try { return (await getDoc(doc(db, coll, id))).exists(); } catch (e) { return false; }
}

/* ---------- состояние питомца ---------- */
export function petRef(petId) { return doc(db, 'pets', petId); }
export function watchPet(petId, cb, err) { return onSnapshot(doc(db, 'pets', petId), (s) => cb(s.exists() ? s.data() : null), err || (() => {})); }
export function savePet(petId, state, me) {
  return setDoc(doc(db, 'pets', petId), { state, updated: serverTimestamp(), by: me }, { merge: true });
}

/* ---------- ошибки по-русски ---------- */
export function errText(e) {
  const c = (e && (e.code || e.message)) || '';
  if (c.indexOf('email-already-in-use') !== -1) return 'Такой логин уже занят';
  if (c.indexOf('invalid-credential') !== -1 || c.indexOf('wrong-password') !== -1 || c.indexOf('user-not-found') !== -1) return 'Неверный логин или пароль';
  if (c.indexOf('weak-password') !== -1) return 'Пароль короче 6 символов';
  if (c.indexOf('too-many-requests') !== -1) return 'Слишком много попыток, подождите';
  if (c.indexOf('network') !== -1 || c.indexOf('unavailable') !== -1) return 'Нет связи с сервером';
  if (c.indexOf('permission-denied') !== -1) return 'Нет доступа';
  if (c === 'self') return 'Это ваш логин';
  if (c === 'nouser') return 'Такого логина нет';
  if (c === 'already') return 'Вы уже друзья';
  if (c === 'havepet') return 'У вас уже есть питомец';
  if (c === 'friendhaspet') return 'У этого друга уже есть питомец';
  return 'Что-то пошло не так';
}
