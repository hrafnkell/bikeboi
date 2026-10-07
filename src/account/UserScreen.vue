<script setup lang="ts">
// Your page: account, weight and FTP, and your rider's look. Only while signed in.
import { onMounted } from 'vue';
import RiderEditor from '../ui/RiderEditor.vue';
import SetupFields from '../ui/SetupFields.vue';
import AccountCard from './AccountCard.vue';

const emit = defineEmits<{ back: [] }>();
onMounted(() => window.scrollTo(0, 0));
</script>

<template>
  <main class="screen user">
    <div class="row"><button class="btn" @click="emit('back')">&larr; Back to start</button></div>
    <h1>Your account</h1>
    <section>
      <h2>Account</h2>
      <AccountCard @signed-out="emit('back')" />
    </section>
    <section>
      <h2>Setup</h2>
      <SetupFields />
    </section>
    <section>
      <h2>Your rider</h2>
      <RiderEditor />
    </section>
    <div class="row"><button class="btn" @click="emit('back')">&larr; Back to start</button></div>
  </main>
</template>
