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
                      <path d="M20 6L9 17l-5-5"/>
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
                placeholder="Start writing. 300 words to move forward..."
                disabled={viewingDay?.sealed || !viewingDay?.isToday}
              />

              <div className={`nav-arrows ${viewingDay?.sealed ? 'visible' : ''}`}>
                <button 
                  className="nav-button" 
                  onClick={navigatePrev}
                  disabled={viewingDayIndex === 0}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
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
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
