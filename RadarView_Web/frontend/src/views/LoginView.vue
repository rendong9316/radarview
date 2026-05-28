<template>
  <div class="login-container">
    <div class="login-card">
      <h1 class="login-title">RadarView</h1>
      <p class="login-subtitle">3D Aircraft Track Viewer</p>

      <div class="login-tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">Sign In</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">Register</button>
      </div>

      <form @submit.prevent="handleSubmit" class="login-form">
        <input v-model="username" type="text" placeholder="Username" class="form-input" required />
        <input v-model="password" type="password" placeholder="Password" class="form-input" required />
        <input v-if="mode === 'register'" v-model="nickname" type="text" placeholder="Nickname (optional)" class="form-input" />
        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
        <button type="submit" class="submit-btn" :disabled="loading">
          {{ loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Register' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const nickname = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleSubmit() {
  errorMsg.value = ''
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(username.value, password.value)
    } else {
      await auth.register(username.value, password.value, nickname.value || undefined)
    }
    router.push('/')
  } catch (e: any) {
    errorMsg.value = e.response?.data?.message || e.message || 'Operation failed'
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.login-card {
  background: rgba(22, 33, 62, 0.8);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 12px;
  padding: 40px;
  width: 380px;
  backdrop-filter: blur(10px);
}

.login-title {
  text-align: center;
  color: #00d4ff;
  font-size: 28px;
  margin: 0 0 4px 0;
}

.login-subtitle {
  text-align: center;
  color: #888;
  font-size: 13px;
  margin: 0 0 24px 0;
}

.login-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 212, 255, 0.2);
}

.login-tabs button {
  flex: 1;
  padding: 8px;
  border: none;
  background: transparent;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.login-tabs button.active {
  background: rgba(0, 212, 255, 0.15);
  color: #00d4ff;
  font-weight: 600;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-input {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #00d4ff;
}

.form-input::placeholder {
  color: #666;
}

.error-msg {
  color: #f44;
  font-size: 12px;
  margin: 0;
  text-align: center;
}

.submit-btn {
  padding: 10px;
  background: #00d4ff;
  color: #1a1a2e;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.submit-btn:hover {
  opacity: 0.85;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
