import api from './index'

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
  nickname?: string
  email?: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  nickname: string
  roles: string[]
}

export interface UserInfo {
  id: number
  username: string
  nickname: string
  email: string
  roles: string[]
  enabled: boolean
}

export const authApi = {
  login(data: LoginRequest) {
    return api.post<{ code: number; data: LoginResponse }>('/auth/login', data)
  },
  register(data: RegisterRequest) {
    return api.post<{ code: number; data: LoginResponse }>('/auth/register', data)
  },
  refresh() {
    return api.post<{ code: number; data: LoginResponse }>('/auth/refresh')
  },
  logout() {
    return api.post<{ code: number; data: null }>('/auth/logout')
  },
  getMe() {
    return api.get<{ code: number; data: UserInfo }>('/auth/me')
  },
}
