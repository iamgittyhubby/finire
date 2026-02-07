import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState([])
  const [currentDayIndex, setCurrentDayIndex] = useState(0)
  const [viewingDayIndex, setViewingDayIndex] = useState(0)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminderHour, setReminderHour] = useState('8')
  const [reminderMinute, setReminderMinute] = useState('00')
  const [reminderAmPm, setReminderAmPm] = useState('AM')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderLoading, setReminderLoading] = useState(false)

  // Check auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/auth')
      } else {
        setUser(session.user)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/auth')
      } else {
        setUser(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  // Load days data
  useEffect(() => {
    if (user) {
      loadDays()
    }
  }, [user])

  // Load existing reminder when modal opens
  useEffect(() => {
    if (showReminderModal && user) {
      loadReminder()
    }
  }, [showReminderModal, user])

  const loadReminder = async () => {
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('Error loading reminder:', error)
      return
    }

    if (data) {
      setReminderEnabled(data.enabled)

      // Parse time_local (e.g., "13:55") back to hour/minute/ampm
      const [hourStr, minuteStr] = data.time_local.split(':')
      let hour = parseInt(hourStr, 10)
      const minute = minuteStr

      let ampm = 'AM'
      if (hour === 0) {
        hour = 12
        ampm = 'AM'
      } else if (hour === 12) {
        ampm = 'PM'
      } else if (hour > 12) {
        hour -= 12
        ampm = 'PM'
      }

      setReminderHour(String(hour))
      setReminderMinute(minute)
      setReminderAmPm(ampm)
    }
  }

  const loadDays = async () => {
    setLoading(true)

    // Get existing days from database
    const { data: existingDays, error } = await supabase
      .from('days')
      .select('*')
      .eq('user_id', user.id)
      .order('day_number', { ascending: true })

    if (error) {
      console.error('Error loading days:', error)
      setLoading(false)
      return
    }

    // Build 30 days array
    const daysArray = []
    let currentDay = 1

    // Find the current day (first unsealed day or day after last sealed)
    if (existingDays.length === 0) {
      currentDay = 1
    } else {
      const lastSealed = existingDays.filter(d => d.sealed).pop()
      if (lastSealed) {
        currentDay = Math.min(lastSealed.day_number + 1, 30)
      } else {
        currentDay = 1
      }
    }

    for (let i = 1; i <= 30; i++) {
      const existing = existingDays.find(d => d.day_number === i)

      if (existing) {
        daysArray.push({
          id: existing.id,
          dayNumber: existing.day_number,
          content: existing.content || '',
          wordCount: existing.word_count || 0,
          sealed: existing.sealed,
          isToday: i === currentDay,
          locked: i > currentDay
        })
      } else {
        daysArray.push({
          id: null,
          dayNumber: i,
          content: '',
          wordCount: 0,
          sealed: false,
          isToday: i === currentDay,
          locked: i > currentDay
        })
      }
    }

    setDays(daysArray)
    setCurrentDayIndex(currentDay - 1)
    setViewingDayIndex(currentDay - 1)
    setContent(daysArray[currentDay - 1]?.content || '')
    setLoading(false)
  }

  // Count words
  const countWords = (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return 0
    return trimmed.split(/\s+/).length
  }

  // Save content to database (debounced)
  const saveContent = useCallback(async (dayNumber, newContent, wordCount) => {
    if (!user) return

    setSaving(true)

    const { data: existing } = await supabase
      .from('days')
      .select('id')
      .eq('user_id', user.id)
      .eq('day_number', dayNumber)
      .single()

    if (existing) {
      await supabase
        .from('days')
        .update({
          content: newContent,
          word_count: wordCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('days')
        .insert({
          user_id: user.id,
          day_number: dayNumber,
          content: newContent,
          word_count: wordCount
        })
    }

    setSaving(false)
  }, [user])

  // Handle content change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (days[viewingDayIndex]?.isToday && !days[viewingDayIndex]?.sealed) {
        saveContent(days[viewingDayIndex].dayNumber, content, countWords(content))
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [content, days, viewingDayIndex, saveContent])

  // Handle text input
  const handleInput = (e) => {
    const newContent = e.target.value
    setContent(newContent)

    // Update local state
    const newDays = [...days]
    newDays[viewingDayIndex] = {
      ...newDays[viewingDayIndex],
      content: newContent,
      wordCount: countWords(newContent)
    }
    setDays(newDays)
  }

  // Handle Tab key
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault() // Stop the browser from moving focus

      const textarea = e.target
      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      // Insert tab character at cursor position
      const newContent =
        content.substring(0, start) +
        '\t' +
        content.substring(end)

      // Update content
      setContent(newContent)

      // Update local state
      const newDays = [...days]
      newDays[viewingDayIndex] = {
        ...newDays[viewingDayIndex],
        content: newContent,
        wordCount: countWords(newContent)
      }
      setDays(newDays)

      // Move cursor after the inserted tab (need to do this after React updates)
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1
      }, 0)
    }
  }

  // Seal the day
  const handleSeal = async () => {
    const day = days[viewingDayIndex]
    if (day.wordCount < 300 || day.sealed) return

    // Update database
    const { data: existing } = await supabase
      .from('days')
      .select('id')
      .eq('user_id', user.id)
      .eq('day_number', day.dayNumber)
      .single()

    if (existing) {
      await supabase
        .from('days')
        .update({ sealed: true })
        .eq('id', existing.id)
    }

    // Reload days to update state
    await loadDays()
  }

  // Select a day
  const selectDay = (index) => {
    const day = days[index]
    if (day.locked) return

    setViewingDayIndex(index)
    setContent(day.content)
  }

  // Navigate between days
  const navigatePrev = () => {
    if (viewingDayIndex > 0) {
      selectDay(viewingDayIndex - 1)
    }
  }

  const navigateNext = () => {
    const nextDay = days[viewingDayIndex + 1]
    if (nextDay && !nextDay.locked) {
      selectDay(viewingDayIndex + 1)
    }
  }

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const handleSetReminder = async () => {
    if (!user) return
    setReminderLoading(true)

    // Convert to 24-hour format
    let hour = parseInt(reminderHour, 10)
    if (reminderAmPm === 'AM') {
      if (hour === 12) hour = 0
    } else {
      if (hour !== 12) hour += 12
    }

    const time24 = `${String(hour).padStart(2, '0')}:${reminderMinute}`

    // Get user's timezone (e.g., "America/Los_Angeles")
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    const { error } = await supabase
      .from('reminders')
      .upsert(
        {
          user_id: user.id,
          time_local: time24,
          timezone: timezone,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (error) {
      console.error(error)
      alert('Failed to save reminder')
      setReminderLoading(false)
      return
    }

    setReminderEnabled(true)
    setReminderLoading(false)
    setShowReminderModal(false)
  }

  const handleDisableReminder = async () => {
    if (!user) return
    setReminderLoading(true)

    const { error } = await supabase
      .from('reminders')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    if (error) {
      console.error(error)
      alert('Failed to disable reminder')
      setReminderLoading(false)
      return
    }

    setReminderEnabled(false)
    setReminderLoading(false)
    setShowReminderModal(false)
  }

  // Calculate stats
  const totalWords = days.reduce((sum, day) => sum + (day.sealed ? day.wordCount : 0), 0) +
    (days[currentDayIndex]?.sealed ? 0 : days[currentDayIndex]?.wordCount || 0)
  const totalDays = days.filter(d => d.sealed).length

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  const viewingDay = days[viewingDayIndex]
  const wordCount = viewingDay?.wordCount || 0
  const progress = Math.min((wordCount / 300) * 100, 100)

  return (
    <>
      <Head>
        <title>Finire</title>
      </Head>
      <div className="app">
        {/* Top Bar with Timeline */}
        <header className="top-bar">
          <div className="top-bar-inner">
            <div className="top-bar-header">
              <div className="logo">Finire</div>
              <div className="user-menu">
                <span className="user-email">{user?.email}</span>

                <button
                  className={`reminder-button ${reminderEnabled ? 'active' : ''}`}
                  type="button"
                  aria-label="Daily reminder"
                  onClick={() => setShowReminderModal(true)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </button>

                <button className="logout-button" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            </div>
            <div className="timeline-container">
              <div className="timeline-label">30-Day Journey</div>
              <div className="timeline-days">
                {days.map((day, index) => (
                  <div
                    key={day.dayNumber}
                    className={`day-box ${day.sealed ? 'sealed' : ''} ${day.isToday ? 'today' : ''} ${day.locked ? 'locked' : ''} ${index === viewingDayIndex ? 'active' : ''}`}
                    onClick={() => selectDay(index)}
                  >
                    <span className="day-number">{day.dayNumber}</span>
                    <div className="day-tooltip">
                      {day.locked
                        ? `Day ${day.dayNumber} · Locked`
                        : day.isToday
                          ? `Today · ${day.wordCount} words`
                          : day.sealed
                            ? `Day ${day.dayNumber} · ${day.wordCount} words`
                            : `Day ${day.dayNumber}`
                      }
                    </div>
                  </div>
                ))}
              </div>
              <div className="stats-row">
                <div className="stat-item">
                  <span className="stat-value">{totalWords.toLocaleString()}</span> total words
                </div>
                <div className="stat-item">
                  <span className="stat-value">{totalDays}</span> days completed
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Writing Area */}
        <div className="main-wrapper">
          <main className="main">
            <header className="header">
              <div className="current-date">
                {viewingDay?.isToday ? `Today — Day ${viewingDay.dayNumber}` : `Day ${viewingDay?.dayNumber}`}
              </div>
              <div className="status-area">
                {viewingDay?.sealed ? (
                  <div className="sealed-badge">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Sealed · {viewingDay.wordCount} words
                  </div>
                ) : (
                  <>
                    <div className={`seal-container ${wordCount >= 300 && viewingDay?.isToday ? 'visible' : ''}`}>
                      <button className="seal-button" onClick={handleSeal}>
                        Seal This
                      </button>
                    </div>
                    <div className="word-count">
                      <span>{wordCount}</span> / 300 words
                    </div>
                  </>
                )}
              </div>
            </header>

            {!viewingDay?.sealed && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${wordCount >= 300 ? 'complete' : ''}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="writing-container">
              <textarea
                className="writing-area"
                value={content}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Start writing. 300 words to move forward..."
                disabled={viewingDay?.sealed || !viewingDay?.isToday}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
              />

              <div className={`nav-arrows ${viewingDay?.sealed ? 'visible' : ''}`}>
                <button
                  className="nav-button"
                  onClick={navigatePrev}
                  disabled={viewingDayIndex === 0}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  Previous day
                </button>
                <button
                  className="nav-button"
                  onClick={navigateNext}
                  disabled={!days[viewingDayIndex + 1] || days[viewingDayIndex + 1].locked}
                >
                  Next day
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Reminder Modal */}
      {showReminderModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowReminderModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              width: 520,
              maxWidth: 'calc(100vw - 32px)',
              padding: 28,
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              Daily writing reminder
            </div>
            <p style={{ marginTop: 8, color: '#666', fontSize: 14 }}>
              Get an email reminder to come back and write.
            </p>

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                value={reminderHour}
                onChange={(e) => setReminderHour(e.target.value)}
                aria-label="Hour"
                disabled={reminderLoading}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={String(h)}>{h}</option>
                ))}
              </select>

              <span>:</span>

              <select
                value={reminderMinute}
                onChange={(e) => setReminderMinute(e.target.value)}
                aria-label="Minute"
                disabled={reminderLoading}
              >
                {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              <select
                value={reminderAmPm}
                onChange={(e) => setReminderAmPm(e.target.value)}
                aria-label="AM/PM"
                disabled={reminderLoading}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>

            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {reminderEnabled && (
                  <button
                    className="modal-danger"
                    onClick={handleDisableReminder}
                    disabled={reminderLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#dc2626',
                      fontSize: 14,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Turn off reminders
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="modal-secondary"
                  onClick={() => setShowReminderModal(false)}
                  disabled={reminderLoading}
                >
                  Cancel
                </button>
                <button
                  className="modal-primary"
                  onClick={handleSetReminder}
                  disabled={reminderLoading}
                >
                  {reminderLoading ? 'Saving...' : (reminderEnabled ? 'Update reminder' : 'Set reminder')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
