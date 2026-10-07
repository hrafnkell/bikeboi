<script setup lang="ts">
// Who you are signed in as, sync status, your rides, sign out, delete account.
import { computed, ref } from 'vue';
import { sync } from '../sync/index.ts';
import { uploads } from '../sync/upload-queue.ts';
import { account, deleteAccount, describeError, logout } from './session.ts';

const emit = defineEmits<{ signedOut: [] }>();
const error = ref('');
const deleting = ref(false);
const deletePassword = ref('');

async function signOut() {
  error.value = '';
  try {
    await logout();
    emit('signedOut');
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
    emit('signedOut');
  } catch (e) {
    error.value = describeError(e);
  }
}

const status = computed(() => {
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
  <div v-if="account.user" class="account-in">
    <p class="account-who">
      Signed in as <strong>{{ account.user.email }}</strong>
      <span v-if="status" class="account-status">{{ status }}</span>
    </p>
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
</template>
