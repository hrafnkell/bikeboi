<script setup lang="ts">
// Sign in, create an account, or see who you are. Optional: the app works without it.
import { computed, ref } from 'vue';
import { decideAndSync, sync, syncAll } from '../sync/index.ts';
import { uploads } from '../sync/upload-queue.ts';
import { account, deleteAccount, describeError, login, logout, register } from './session.ts';

const email = ref('');
const password = ref('');
const error = ref('');
const deleting = ref(false);
const deletePassword = ref('');

async function submit(create: boolean) {
  error.value = '';
  try {
    await (create ? register : login)(email.value, password.value);
    password.value = '';
    await syncAll();
  } catch (e) {
    error.value = describeError(e);
  }
}

async function signOut() {
  error.value = '';
  try {
    await logout();
  } catch (e) {
    error.value = describeError(e);
  }
}

async function removeAccount() {
  if (!confirm('Delete your account and everything stored with it? This cannot be undone.')) return;
  error.value = '';
  try {
    await deleteAccount(deletePassword.value);
    deleting.value = false;
    deletePassword.value = '';
  } catch (e) {
    error.value = describeError(e);
  }
}

const status = computed(() => {
  if (sync.needsDecision) return 'This browser holds another rider’s bests and workouts.';
  switch (sync.state) {
    case 'syncing': return 'Syncing…';
    case 'synced': return uploads.pending > 0 ? `Synced · ${uploads.pending} ride${uploads.pending === 1 ? '' : 's'} waiting to upload` : 'Synced';
    case 'offline': return 'Offline · changes will sync when you are back online';
    case 'error': return 'Sync failed · will try again';
    default: return '';
  }
});
</script>

<template>
  <section class="account">
    <h2>Account</h2>
    <div v-if="account.status === 'in' && account.user" class="account-in">
      <p class="account-who">
        Signed in as <strong>{{ account.user.email }}</strong>
        <span v-if="status" class="account-status">{{ status }}</span>
      </p>
      <div v-if="sync.needsDecision" class="row">
        <button class="btn btn-primary" :disabled="account.busy" @click="decideAndSync('merge')">Merge them into my account</button>
        <button class="btn" :disabled="account.busy" @click="decideAndSync('replace')">Replace with my account’s</button>
      </div>
      <div class="row">
        <a class="btn" href="#rides">My rides</a>
        <button class="btn" :disabled="account.busy" @click="signOut">Sign out</button>
        <button class="btn btn-link" :disabled="account.busy" @click="deleting = !deleting">Delete account…</button>
      </div>
      <div v-if="deleting" class="account-delete">
        <p class="note">Deleting removes your settings, bests, workouts and rides from the account. Download any rides you want to keep first.</p>
        <form class="row" @submit.prevent="removeAccount">
          <input v-model="deletePassword" type="password" autocomplete="current-password" placeholder="Your password" aria-label="Password to confirm deletion" required />
          <button class="btn btn-danger" :disabled="account.busy || !deletePassword">Delete my account</button>
        </form>
      </div>
      <p v-if="error" class="account-error">{{ error }}</p>
    </div>
    <form v-else class="account-form" @submit.prevent="submit(false)">
      <div class="row">
        <input v-model="email" type="email" autocomplete="email" placeholder="Email" aria-label="Email" required />
        <input v-model="password" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required minlength="8" />
      </div>
      <div class="row">
        <button class="btn btn-primary" :disabled="account.busy || account.status === 'unknown'">Sign in</button>
        <button type="button" class="btn" :disabled="account.busy || account.status === 'unknown'" @click="submit(true)">Create account</button>
      </div>
      <p v-if="error" class="account-error">{{ error }}</p>
      <p class="note">Optional. An account syncs your settings, bests and workouts between devices and keeps your rides. Nothing else is stored; see <a href="#about">About</a>.</p>
    </form>
  </section>
</template>
