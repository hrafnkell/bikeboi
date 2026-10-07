<script setup lang="ts">
// Sign in or create an account, in a small dialog opened from the header icon.
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { decideAndSync, sync, syncAll } from '../sync/index.ts';
import { account, describeError, login, register } from './session.ts';

const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const email = ref('');
const password = ref('');
const error = ref('');

onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.open && dialog.value.close());

async function submit(create: boolean) {
  error.value = '';
  try {
    await (create ? register : login)(email.value, password.value);
    password.value = '';
    await syncAll();
    // another rider's bests and workouts on this browser: ask before closing
    if (!sync.needsDecision) emit('close');
  } catch (e) {
    error.value = describeError(e);
  }
}

async function decide(mode: 'merge' | 'replace') {
  await decideAndSync(mode);
  emit('close');
}
</script>

<template>
  <dialog ref="dialog" class="modal login" aria-labelledby="login-title" @close="emit('close')" @cancel.prevent="emit('close')">
    <div v-if="account.status === 'in' && sync.needsDecision">
      <h2 id="login-title">Welcome back</h2>
      <p>This browser holds another rider’s bests and workouts. Merge them into your account, or replace them with what your account holds?</p>
      <div class="row">
        <button class="btn btn-primary" :disabled="account.busy" @click="decide('merge')">Merge them into my account</button>
        <button class="btn" :disabled="account.busy" @click="decide('replace')">Replace with my account’s</button>
      </div>
    </div>
    <form v-else class="account-form" @submit.prevent="submit(false)">
      <h2 id="login-title">Your account</h2>
      <input v-model="email" type="email" autocomplete="email" placeholder="Email" aria-label="Email" required />
      <input v-model="password" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required minlength="8" />
      <div class="row">
        <button class="btn btn-primary" :disabled="account.busy || account.status === 'unknown'">Sign in</button>
        <button type="button" class="btn" :disabled="account.busy || account.status === 'unknown'" @click="submit(true)">Create account</button>
        <button type="button" class="btn btn-link" @click="emit('close')">Not now</button>
      </div>
      <p v-if="error" class="account-error">{{ error }}</p>
      <p class="note">Optional. An account syncs your settings, bests and workouts between devices and keeps your rides. Nothing else is stored; see <a href="#about" @click="emit('close')">About</a>.</p>
    </form>
  </dialog>
</template>
