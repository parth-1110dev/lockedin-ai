import supabase from './supabase.js'

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
        console.log('[Signup] Attempting to insert user:', { id: user.id, email: user.email })
        
        const { data: existing, error: checkError } = await supabase
          .from('users')
          .select('id')
          .eq('id', user.id)
          .maybeSingle()

        if (checkError) {
          console.error('[Signup] Error checking if user exists:', checkError)
        }

        if (!existing) {
          console.log('[Signup] User does not exist, inserting new row...')
          const { error: insertError } = await supabase.from('users').insert([
            { id: user.id, email: user.email, plan: 'free' }
          ])
          
          if (insertError) {
            console.error('[Signup] Failed to insert user into users table:', insertError)
          } else {
            console.log('[Signup] User successfully inserted into users table')
          }
        } else {
          console.log('[Signup] User already exists in users table, skipping insert')
        }
      } catch (e) {
        console.error('[Signup] Unexpected error during user table insertion:', e)
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

    // Immediately reset UI without reloading the page
    try {
      if (typeof showLoggedOutUI === 'function') showLoggedOutUI()
    } catch (_e) {}
  } catch (err) {
    alert('Unexpected error: ' + err.message)
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
    if (userId) await fetchAndStoreUserPlan(userId)
  } catch (_e) {
    // ignore
  }

  return session.user
}

// Fetch user's plan from `users` table and store in localStorage and window
async function fetchAndStoreUserPlan(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase.from('users').select('plan').eq('id', userId).maybeSingle()
    if (error) return null
    const plan = (data && data.plan) || 'free'
    window.localStorage.setItem('userPlan', String(plan))
    window.currentUserPlan = String(plan)
    return plan
  } catch (_e) {
    return null
  }
}

function subscribeToAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (typeof callback === 'function') {
      callback(session || null)
    }
  })

  return data?.subscription || null
}

// Show/hide UI based on auth state
function showLoggedInUI(user) {
  const loginEl = document.querySelector('a[aria-label="Login"], button[aria-label="Login"]')
  const signupEl = document.querySelector('a[aria-label="Sign Up"], a[aria-label="Sign up"], button[aria-label="Sign Up"]')
  const profileBtn = document.getElementById('profileBtn')
  const profileInitial = document.getElementById('profileInitial')
  const sidebarAvatar = document.getElementById('sidebarAvatar')
  const sidebarEmail = document.getElementById('sidebarEmail')
  const sidebarPlan = document.getElementById('sidebarPlan')

  if (loginEl) loginEl.hidden = true
  if (signupEl) signupEl.hidden = true
  if (profileBtn) profileBtn.hidden = false

  const email = user?.email || ''
  const initial = email.trim() ? email.trim().charAt(0).toUpperCase() : ''

  if (profileInitial) profileInitial.textContent = initial
  if (sidebarAvatar) sidebarAvatar.textContent = initial
  if (sidebarEmail) {
    sidebarEmail.textContent = email
    sidebarEmail.title = email
  }

  // ensure plan is present (non-blocking)
  try {
    const userId = user?.id
    if (userId) {
      fetchAndStoreUserPlan(userId).then(() => {
        if (sidebarPlan) sidebarPlan.textContent = window.currentUserPlan || window.localStorage.getItem('userPlan') || 'free'
      })
    }
  } catch (_e) {}
}

function showLoggedOutUI() {
  const loginEl = document.querySelector('a[aria-label="Login"], button[aria-label="Login"]')
  const signupEl = document.querySelector('a[aria-label="Sign Up"], a[aria-label="Sign up"], button[aria-label="Sign Up"]')
  const profileBtn = document.getElementById('profileBtn')
  const profileInitial = document.getElementById('profileInitial')
  const sidebarAvatar = document.getElementById('sidebarAvatar')
  const sidebarEmail = document.getElementById('sidebarEmail')
  const sidebarPlan = document.getElementById('sidebarPlan')

  if (loginEl) loginEl.hidden = false
  if (signupEl) signupEl.hidden = false
  if (profileBtn) profileBtn.hidden = true

  if (profileInitial) profileInitial.textContent = ''
  if (sidebarAvatar) sidebarAvatar.textContent = ''
  if (sidebarEmail) {
    sidebarEmail.textContent = ''
    sidebarEmail.removeAttribute('title')
  }
  if (sidebarPlan) sidebarPlan.textContent = ''

  // close any open sidebars if present
  const accountSidebar = document.getElementById('accountSidebar')
  const accountOverlay = document.getElementById('accountOverlay')
  if (accountSidebar) {
    accountSidebar.classList.remove('is-open')
    accountSidebar.setAttribute('aria-hidden', 'true')
  }
  if (accountOverlay) {
    accountOverlay.classList.remove('is-open')
    accountOverlay.setAttribute('aria-hidden', 'true')
  }
}

// Wire a global auth state listener and run an initial session check.
// This keeps UI visibility in sync across pages that import this module.
try {
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      showLoggedInUI(session.user)
    } else {
      showLoggedOutUI()
    }
  })

  // Run immediate check on module load
  ;(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const session = data?.session || null
      if (session && session.user) showLoggedInUI(session.user)
      else showLoggedOutUI()
    } catch (_e) {
      showLoggedOutUI()
    }
  })()
} catch (_err) {
  // non-fatal: if supabase client is missing or errors, don't throw
}

function wireAuthUI() {
  const loginEl = document.querySelector('a[aria-label="Login"], button[aria-label="Login"]')
  const signupEl = document.querySelector('a[aria-label="Sign Up"], a[aria-label="Sign up"], button[aria-label="Sign Up"]')
  const logoutEl = document.querySelector('a[aria-label="Logout"], button[aria-label="Logout"], #logoutBtn')

  if (loginEl) {
    loginEl.addEventListener('click', (e) => {
      e.preventDefault()
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `auth.html?returnTo=${returnTo}`
    })
  }

  if (signupEl) {
    signupEl.addEventListener('click', (e) => {
      e.preventDefault()
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `auth.html?returnTo=${returnTo}`
    })
  }

  if (logoutEl) {
    logoutEl.addEventListener('click', async (e) => {
      e.preventDefault()
      await signOut()
    })
  }
}

// Auto-wire UI on load (keeps logic modular and non-invasive)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireAuthUI)
} else {
  wireAuthUI()
}

export { signUpWithEmail, signInWithEmail, signOut, getSession, ensureAuthenticated, fetchAndStoreUserPlan, subscribeToAuthStateChange, showLoggedInUI, showLoggedOutUI }
