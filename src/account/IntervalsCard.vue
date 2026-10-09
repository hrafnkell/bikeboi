<script setup lang="ts">
// Connect an intervals.icu account with its API key; rides can then be sent there.
import { onMounted, ref } from 'vue';
import { api } from '../api/client.ts';
import { describeError } from './session.ts';

interface Status {
  connected: boolean;
  athleteId: string;
  athleteName: string;
  auto: boolean;
  available: boolean;
}

const status = ref<Status>({ connected: false, athleteId: '', athleteName: '', auto: false, available: true });
const apiKey = ref('');
const auto = ref(true);
const busy = ref(false);
const error = ref('');
const loaded = ref(false);

async function refresh() {
  try {
    status.value = await api<Status>('GET', '/api/intervals');
    auto.value = status.value.connected ? status.value.auto : true;
  } catch (e) {
    error.value = describeError(e);
  } finally {
    loaded.value = true;
  }
}

async function connect() {
  busy.value = true;
  error.value = '';
  try {
    const s = await api<Status>('PUT', '/api/intervals', { apiKey: apiKey.value, auto: auto.value });
    status.value = { ...s, available: true };
    apiKey.value = '';
  } catch (e) {
    error.value = describeError(e);
  } finally {
    busy.value = false;
  }
}

async function setAuto(value: boolean) {
  busy.value = true;
  error.value = '';
  try {
    const s = await api<Status>('PUT', '/api/intervals', { auto: value });
    status.value = { ...s, available: true };
  } catch (e) {
    error.value = describeError(e);
  } finally {
    busy.value = false;
  }
}

async function disconnect() {
  if (!confirm('Disconnect intervals.icu? Rides already sent stay there; the key is forgotten here.')) return;
  busy.value = true;
  error.value = '';
  try {
    await api('DELETE', '/api/intervals');
    await refresh();
  } catch (e) {
    error.value = describeError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <div class="intervals">
    <p v-if="loaded && !status.available" class="note">Connecting intervals.icu is not set up on this server.</p>
    <template v-else-if="status.connected">
      <p class="account-who">
        Connected as <strong>{{ status.athleteName }}</strong>
        <span class="account-status">{{ status.athleteId }}</span>
      </p>
      <label class="field">
        <span>Send rides automatically when they finish</span>
        <input type="checkbox" :checked="status.auto" :disabled="busy" aria-label="Send rides to intervals.icu automatically" @change="setAuto(($event.target as HTMLInputElement).checked)" />
      </label>
      <p class="note">Rides you ride from now on go to intervals.icu as "bikeboi: &lt;circuit&gt;". Earlier rides can be sent one by one from My rides. Leave automatic sending off if Garmin Connect or Strava already feeds your intervals.icu: a ride that arrives twice shows up twice.</p>
      <div class="row">
        <button class="btn" :disabled="busy" @click="disconnect">Disconnect</button>
      </div>
    </template>
    <form v-else-if="loaded" class="account-form" @submit.prevent="connect">
      <p class="note">
        Send your rides to <a href="https://intervals.icu" target="_blank" rel="noopener">intervals.icu</a>. You need your personal API key: in intervals.icu go to Settings, scroll to Developer Settings and copy the key. It is stored encrypted and only ever used to talk to intervals.icu.
      </p>
      <div class="row">
        <input v-model="apiKey" type="password" autocomplete="off" placeholder="intervals.icu API key" aria-label="intervals.icu API key" required minlength="8" />
        <button class="btn btn-primary" :disabled="busy || apiKey.length < 8">{{ busy ? 'Checking…' : 'Connect' }}</button>
      </div>
      <label class="field">
        <span>Send rides automatically when they finish</span>
        <input v-model="auto" type="checkbox" aria-label="Send rides to intervals.icu automatically" />
      </label>
      <p class="note">Leave automatic sending off if Garmin Connect or Strava already feeds your intervals.icu: a ride that arrives twice shows up twice.</p>
    </form>
    <p v-if="error" class="account-error">{{ error }}</p>
  </div>
</template>
