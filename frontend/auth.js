import supabase from './supabase.js'

function getPlanState() {
  return window.LockedInPlanState || null
}

function getCurrentPlan() {
  const planState = getPlanState()
  if (planState && typeof planState.getPlan === 'function') {
    return planState.getPlan()
  }

  const plan = window.currentUserPlan || 'free'
  const normalized = String(plan).trim().toLowerCase()
  if (normalized === 'pro' || normalized === 'elite' || normalized === 'free') {
    return normalized
  }
  return 'free'
}

function setCurrentPlan(plan, options = {}) {
  const planState = getPlanState()
  if (planState && typeof planState.setPlan === 'function') {
    return planState.setPlan(plan, options)
  }

  const previousPlan = getCurrentPlan()
  const normalized = String(plan || 'free').trim().toLowerCase()
  const nextPlan = normalized === 'pro' || normalized === 'elite' || normalized === 'free' ? normalized : 'free'
  window.currentUserPlan = nextPlan
  window.dispatchEvent(
    new CustomEvent('userPlanUpdated', {
      detail: {
        plan: nextPlan,
        previousPlan,
        source: String(options.source || 'fallback'),
        userId: String(options.userId || '').trim(),
      },
    })
  )
  return nextPlan
}

// ============================================================================
// CENTRALIZED NAVBAR AUTH STATE MANAGEMENT
// ============================================================================
// This is the single source of truth for all navbar auth-state rendering.
// Call this function whenever the authentication state changes.

function updateNavbarAuthState(user) {
  console.log("AUTH STATE UPDATE:", user)

  const loginBtn = document.getElementById('loginBtn')
  const profileBtn = document.getElementById('profileBtn')
  const profileInitial = document.getElementById('profileInitial')
  const sidebarAvatar = document.getElementById('sidebarAvatar')
  const sidebarEmail = document.getElementById('sidebarEmail')
  const sidebarPlan = document.getElementById('sidebarPlan')
  const accountSidebar = document.getElementById('accountSidebar')
  const accountOverlay = document.getElementById('accountOverlay')

  if (user && user.id) {
    // USER IS AUTHENTICATED
    
    // 1. Hide login button
    if (loginBtn) {
      loginBtn.style.display = 'none'
      console.log("LOGIN BTN FOUND:", loginBtn)
    }
    
    // 2. Show profile circle
    if (profileBtn) {
      profileBtn.style.display = 'flex'
      console.log("PROFILE BTN FOUND:", profileBtn)
    }
    
    // 3. Populate profile information
    const email = user.email || ''
    const initial = email.trim() ? email.trim().charAt(0).toUpperCase() : 'U'
    
    if (profileInitial) {
      profileInitial.textContent = initial
    }
    if (sidebarAvatar) {
      sidebarAvatar.textContent = initial
    }
    if (sidebarEmail) {
      sidebarEmail.textContent = email
      sidebarEmail.title = email
    }
    
    // 4. Fetch and populate user plan
    if (user.id) {
      ;(async () => {
        try {
          await syncSupabaseUserRecord(user, 'navbar_auth_state')
        } catch (syncError) {
          console.warn('[User Sync] Navbar sync failed; continuing with plan read.', syncError)
        }

        try {
          await fetchAndStoreUserPlan(user.id)
          if (sidebarPlan) {
            const plan = getCurrentPlan()
            const planLabel = getPlanLabel(plan)
            sidebarPlan.textContent = planLabel
          }
        } catch (_error) {
          // Default to free if fetch fails
          if (sidebarPlan) {
            sidebarPlan.textContent = 'Free'
          }
        }
      })()
    }
  } else {
    // USER IS NOT AUTHENTICATED
    setCurrentPlan('free', { source: 'auth' })
    
    // 1. Show login button
    if (loginBtn) {
      loginBtn.style.display = ''
    }
    
    // 2. Completely hide profile circle (do not render visually at all)
    if (profileBtn) {
      profileBtn.style.display = 'none'
    }
    
    // 3. Clear all profile information
    if (profileInitial) {
      profileInitial.textContent = ''
    }
    if (sidebarAvatar) {
      sidebarAvatar.textContent = ''
    }
    if (sidebarEmail) {
      sidebarEmail.textContent = ''
      sidebarEmail.removeAttribute('title')
    }
    if (sidebarPlan) {
      sidebarPlan.textContent = ''
    }
    
    // 4. Close and hide sidebar completely
    if (accountSidebar) {
      accountSidebar.classList.remove('is-open')
      accountSidebar.setAttribute('aria-hidden', 'true')
    }
    if (accountOverlay) {
      accountOverlay.classList.remove('is-open')
      accountOverlay.setAttribute('aria-hidden', 'true')
    }
  }
}

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

async function signUpWithEmail(email, password) {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      alert('Sign up error: ' + error.message)
      return
    }

    // Try to get the user object (may be in data or from auth.getUser())
    let user = data?.user || null
    if (!user) {
      const userRes = await supabase.auth.getUser()
      user = userRes?.data?.user || null
    }

    // Insert into `users` table if not present
    if (user && user.id) {
      try {
        await syncSupabaseUserRecord(user, 'signup')
        console.log('[Signup] User synced to users table using auth ID:', { id: user.id, email: user.email })
      } catch (e) {
        console.error('[Signup] Unexpected error during user table sync:', e)
      }
    } else {
      console.warn('[Signup] User object or ID missing:', { user, userId: user?.id })
    }

    // On success, redirect to auth page (auth flow handled there)
    window.location.href = 'auth.html'
  } catch (err) {
    alert('Unexpected error: ' + err.message)
  }
}

async function signInWithEmail(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      alert('Login error: ' + error.message)
      return
    }

    // Fetch and store user plan if possible before redirecting
    const userId = data?.user?.id || null
    if (userId) {
      try {
        await syncSupabaseUserRecord(data?.user || null, 'login')
        await fetchAndStoreUserPlan(userId)
      } catch (_e) {
        // ignore
      }
    }

    window.location.href = 'auth.html'
  } catch (err) {
    alert('Unexpected error: ' + err.message)
  }
}

async function signOut() {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      alert('Logout error: ' + error.message)
      return
    }

    // Immediately update navbar to logged-out state
    updateNavbarAuthState(null)
  } catch (err) {
    alert('Unexpected error: ' + err.message)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getApiBase() {
  const host = window.location.hostname
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:8000'
  }

  return `http://${host}:8000`
}

function normalizeStoredPlan(plan) {
  const normalized = String(plan || '').trim().toLowerCase()
  if (normalized === 'pro' || normalized === 'elite' || normalized === 'free') {
    return normalized
  }
  return 'free'
}

async function resolveCurrentUser(explicitUser = null) {
  if (explicitUser && explicitUser.id) {
    return explicitUser
  }

  try {
    const { data } = await supabase.auth.getSession()
    const sessionUser = data?.session?.user || null
    if (sessionUser && sessionUser.id) {
      return sessionUser
    }
  } catch (_error) {
    // ignore and fall through to auth.getUser()
  }

  try {
    const userRes = await supabase.auth.getUser()
    return userRes?.data?.user || null
  } catch (_error) {
    return null
  }
}

async function syncSupabaseUserRecord(explicitUser = null, source = 'unknown') {
  const user = await resolveCurrentUser(explicitUser)
  if (!user || !user.id) {
    console.warn('[User Sync] Missing authenticated user; skipping sync.', { source })
    return null
  }

  const userId = String(user.id).trim()
  const email = String(user.email || '').trim().toLowerCase()

  try {
    const response = await window.fetch(`${getApiBase()}/sync-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        email,
        source,
      }),
    })

    let payload = null
    try {
      payload = await response.json()
    } catch (_parseError) {
      payload = null
    }

    if (response.ok && payload && payload.success) {
      console.log('[User Sync] Backend sync confirmed:', payload)
      return payload
    }

    console.warn('[User Sync] Backend sync failed; falling back to direct Supabase repair.', {
      status: response.status,
      payload,
      source,
    })
  } catch (backendError) {
    console.warn('[User Sync] Backend sync unavailable; falling back to direct Supabase repair.', {
      source,
      error: backendError,
    })
  }

  try {
    const { data: existingById, error: idCheckError } = await supabase
      .from('users')
      .select('id,email,plan')
      .eq('id', userId)
      .maybeSingle()

    if (idCheckError) {
      console.warn('[User Sync] Direct by-id lookup error:', idCheckError)
    }

    if (existingById && existingById.id) {
      const updates = {}
      const existingEmail = String(existingById.email || '').trim().toLowerCase()
      if (email && existingEmail !== email) {
        updates.email = email
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('users')
          .update(updates)
          .eq('id', userId)

        if (updateError) {
          console.warn('[User Sync] Direct update error:', updateError)
        }
      }

      const { data: confirmedById } = await supabase
        .from('users')
        .select('id,email,plan')
        .eq('id', userId)
        .maybeSingle()

      const confirmedPlan = normalizeStoredPlan(confirmedById?.plan || existingById.plan)
      return {
        success: true,
        matched: true,
        action: 'existing_match',
        user_id: userId,
        users_table_id: confirmedById?.id || userId,
        email: confirmedById?.email || email,
        plan: confirmedPlan,
      }
    }

    let legacyRow = null
    if (email) {
      const { data: existingByEmail, error: emailCheckError } = await supabase
        .from('users')
        .select('id,email,plan')
        .eq('email', email)
        .maybeSingle()

      if (emailCheckError) {
        console.warn('[User Sync] Direct email lookup error:', emailCheckError)
      }

      legacyRow = existingByEmail || null
    }

    if (legacyRow && String(legacyRow.id || '').trim() !== userId) {
      const legacyPlan = normalizeStoredPlan(legacyRow.plan)
      const { error: repairError } = await supabase
        .from('users')
        .update({
          id: userId,
          email: email || legacyRow.email || '',
          plan: legacyPlan,
        })
        .eq('id', String(legacyRow.id).trim())

      if (repairError) {
        console.warn('[User Sync] Direct repair error:', repairError)
      }
    } else {
      const { error: insertError } = await supabase.from('users').insert([
        { id: userId, email, plan: 'free' },
      ])

      if (insertError) {
        console.warn('[User Sync] Direct insert error:', insertError)
      }
    }

    const { data: confirmedRow } = await supabase
      .from('users')
      .select('id,email,plan')
      .eq('id', userId)
      .maybeSingle()

    if (!confirmedRow || String(confirmedRow.id || '').trim() !== userId) {
      throw new Error(`User sync verification failed for auth user ID ${userId}`)
    }

    return {
      success: true,
      matched: true,
      action: 'repaired_or_inserted',
      user_id: userId,
      users_table_id: confirmedRow.id,
      email: confirmedRow.email || email,
      plan: normalizeStoredPlan(confirmedRow.plan),
    }
  } catch (fallbackError) {
    console.error('[User Sync] Direct Supabase repair failed:', fallbackError)
    throw fallbackError
  }
}

// Get current session (returns session object or null)
async function getSession() {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return null
    return data.session || null
  } catch (err) {
    return null
  }
}

// Ensure the user is authenticated on pages that require auth.
// If no session -> redirect to `redirectTo` (default: auth.html).
async function ensureAuthenticated(redirectTo = 'auth.html') {
  const session = await getSession()
  if (!session) {
    // preserve current path so user can return after login if desired
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.href = `${redirectTo}?returnTo=${returnTo}`
    return null
  }

  // store basic user info in memory for optional use
  window.currentUser = session.user || null
  // fetch and store plan
  try {
    const userId = session.user?.id
    if (session.user?.id) {
      try {
        await syncSupabaseUserRecord(session.user, 'ensure_authenticated')
      } catch (syncError) {
        console.warn('[User Sync] ensureAuthenticated sync failed; continuing.', syncError)
      }

      await fetchAndStoreUserPlan(userId)
    }
  } catch (_e) {
    // ignore
  }

  return session.user
}

// Fetch user's plan from `users` table and store it in memory for the current session
async function fetchAndStoreUserPlan(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase.from('users').select('plan').eq('id', userId).maybeSingle()
    if (error) return null
    const plan = normalizeStoredPlan((data && data.plan) || 'free')
    setCurrentPlan(plan, { source: 'auth', userId })
    return plan
  } catch (_e) {
    setCurrentPlan('free', { source: 'auth', userId })
    return null
  }
}

// Helper to get readable plan label
function getPlanLabel(plan) {
  const normalized = String(plan || 'free').trim().toLowerCase()
  if (normalized === 'pro') return 'Pro'
  if (normalized === 'elite') return 'Elite'
  return 'Free'
}

// ============================================================================
// INITIALIZATION AND AUTH STATE SYNC
// ============================================================================

// Set up auth state listener on module load.
// This listener will call updateNavbarAuthState() whenever auth state changes.
try {
  supabase.auth.onAuthStateChange((event, session) => {
    // Call centralized function with user or null
    updateNavbarAuthState(session?.user || null)
  })

  // Run immediate check on module load to sync navbar with current session
  ;(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const session = data?.session || null
      // Call centralized function with user or null
      updateNavbarAuthState(session?.user || null)
    } catch (_e) {
      // If anything goes wrong, assume logged out
      updateNavbarAuthState(null)
    }
  })()
} catch (_err) {
  // non-fatal: if supabase client is missing or errors, don't throw
}

// ============================================================================
// EXPORTS
// ============================================================================

export { 
  signUpWithEmail, 
  signInWithEmail, 
  signOut, 
  getSession, 
  ensureAuthenticated, 
  fetchAndStoreUserPlan, 
  syncSupabaseUserRecord,
  updateNavbarAuthState 
}
