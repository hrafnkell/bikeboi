<script setup lang="ts">
// The header's user icon: opens sign-in when anonymous, your account page when signed in.
import { ref } from 'vue';
import LoginDialog from './LoginDialog.vue';
import { account } from './session.ts';

const open = ref(false);

function click() {
  if (account.status === 'in') location.hash = '#user';
  else open.value = true;
}
</script>

<template>
  <button
    class="icon-btn user-btn"
    :class="{ on: account.status === 'in' }"
    :aria-label="account.status === 'in' ? 'Your account' : 'Sign in'"
    :title="account.status === 'in' ? account.user?.email : 'Sign in'"
    @click="click"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <i v-if="account.status === 'in'" class="user-dot" aria-hidden="true"></i>
  </button>
  <LoginDialog v-if="open" @close="open = false" />
</template>
