// multiple free dynamic dns urls pointing to backend server in case one is down or blocked on school wifi
const API_URLS = [
  "https://scibowl.chickenkiller.com",
  "https://scibowl.myaddr.tools",
  "https://scibowl.myaddr.dev",
  "https://scibowl.myaddr.io"
];

let currentAPIIndex = 0;
let typingJob = null;
let currentQuestion = null;
let typingInterval = null;
let timeLeft = 0;
let timerId = null;
let buzzed = false;
let waitingForNext = false;

// track scores for each category
let scores = {};
let availableCategories = [];

// LaTeX rendering function
function renderLatex(element) {
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement(element, {
      delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "$", right: "$", display: false},
        {left: "\\[", right: "\\]", display: true},
        {left: "\\(", right: "\\)", display: false}
      ],
      throwOnError: false
    });
  }
}

// Try fetching from different backend URLs until one works
async function fetchWithFallback(endpoint, options = {}) {
  // Ensure credentials are included for cookies
  options.credentials = 'include';
  
  for (let i = 0; i < API_URLS.length; i++) {
    const urlIndex = (currentAPIIndex + i) % API_URLS.length;
    const url = API_URLS[urlIndex] + endpoint;
    
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        // Success! Remember this URL for next time
        currentAPIIndex = urlIndex;
        return response;
      }
    } catch (error) {
      console.log(`Failed to fetch from ${API_URLS[urlIndex]}, trying next...`);
      // Continue to next URL
    }
  }
  
  // All URLs failed
  throw new Error('All backend URLs failed');
}

async function loadCategories() {
  try {
    const res = await fetchWithFallback('/api/categories');
    const data = await res.json();
    availableCategories = data.categories;
    showCategorySelection();
  } catch (error) {
    console.error("Error loading categories:", error);
    alert("Failed to load categories from all backend servers. Check your internet connection.");
  }
}

function detectMobile() {
  const ua = navigator.userAgent.toLowerCase();
  return /mobi|android|iphone|ipad/i.test(ua);
}

// add a class to <body>
if (detectMobile()) {
  document.body.classList.add("mobile");
} else {
  document.body.classList.add("desktop");
}

function showCategorySelection() {
  const container = document.getElementById("category-select");
  container.innerHTML = "<h3>Choose categories:</h3>";
  availableCategories.forEach((cat) => {
    const id = "cat_" + cat.replace(/\s+/g, "_");
    container.innerHTML += `
      <label>
        <input type="checkbox" id="${id}" value="${cat}" checked /> ${cat}
      </label><br>
    `;
  });
}

function getSelectedCategories() {
  const checkboxes = document.querySelectorAll("#category-select input[type=checkbox]");
  return [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
}

function updateScores() {
  const scoresDiv = document.getElementById("scores");
  let html = "<h3>Scores by Category</h3>";
  for (const [cat, s] of Object.entries(scores)) {
    html += `<div>${cat}: ✅ ${s.correct} | ❌ ${s.wrong}</div>`;
  }
  scoresDiv.innerHTML = html;
}

function startTimer(seconds, onEnd) {
  timeLeft = seconds;
  updateTimer();
  timerId = setInterval(() => {
    timeLeft--;
    updateTimer();
    if (timeLeft <= 0) {
      clearInterval(timerId);
      onEnd();
    }
  }, 1000);
}

function updateTimer() {
  const tDiv = document.getElementById("timer");
  if (tDiv) {
    tDiv.textContent = "⏱ " + timeLeft;
  }
}

function showQuestion(q) {
  // Fix over-escaped backslashes
  q = q.replace(/\\\\/g, '\\');
  
  // Clear any existing typing interval first
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
  
  const qDiv = document.getElementById("question");
  qDiv.innerHTML = "";
  const speed = parseInt(document.getElementById("speed").value) || 50;
  
  // Parse the string to find LaTeX segments
  const parts = [];
  let remaining = q;
  const delimiters = [
    { start: '$$', end: '$$' },
    { start: '\\[', end: '\\]' },
    { start: '\\(', end: '\\)' },
    { start: '$', end: '$' }
  ];
  
  while (remaining.length > 0) {
    let earliestMatch = null;
    let earliestPos = remaining.length;
    let matchedDelim = null;
    
    // Find the earliest LaTeX delimiter
    for (const delim of delimiters) {
      const pos = remaining.indexOf(delim.start);
      if (pos !== -1 && pos < earliestPos) {
        earliestPos = pos;
        matchedDelim = delim;
        earliestMatch = pos;
      }
    }
    
    if (earliestMatch !== null && matchedDelim) {
      // Add text before LaTeX
      if (earliestMatch > 0) {
        parts.push({ type: 'text', content: remaining.substring(0, earliestMatch) });
      }
      
      // Find end of LaTeX
      const startLen = matchedDelim.start.length;
      const endPos = remaining.indexOf(matchedDelim.end, earliestMatch + startLen);
      
      if (endPos !== -1) {
        const latexSegment = remaining.substring(earliestMatch, endPos + matchedDelim.end.length);
        parts.push({ type: 'latex', content: latexSegment });
        remaining = remaining.substring(endPos + matchedDelim.end.length);
      } else {
        // No closing delimiter found, treat as text
        parts.push({ type: 'text', content: remaining });
        remaining = '';
      }
    } else {
      // No more LaTeX found
      if (remaining.length > 0) {
        parts.push({ type: 'text', content: remaining });
      }
      remaining = '';
    }
  }
  
  // Now animate
  let partIndex = 0;
  let charIndex = 0;
  let built = '';
  
  typingInterval = setInterval(() => {
    if (partIndex >= parts.length) {
      clearInterval(typingInterval);
      const escaped = built.replace(/&/g, '&amp;')
                          .replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;')
                          .replace(/\n/g, '<br>');
      qDiv.innerHTML = escaped;
      renderLatex(qDiv);
      
      startTimer(5, () => {
        if (!buzzed) {
          document.getElementById("results").textContent =
            "Time up! You did not buzz.";
          waitingForNext = true;
        }
      });
      return;
    }
    
    const part = parts[partIndex];
    
    if (part.type === 'latex') {
      // Add entire LaTeX at once
      built += part.content;
      partIndex++;
      charIndex = 0;
    } else {
      // Add one character of text
      if (charIndex < part.content.length) {
        built += part.content[charIndex];
        charIndex++;
      } else {
        partIndex++;
        charIndex = 0;
        return; // Skip to next iteration
      }
    }
    
    const escaped = built.replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/\n/g, '<br>');
    qDiv.innerHTML = escaped;
    renderLatex(qDiv);
    
  }, speed);
}

function buzz() {
  if (waitingForNext) {
    nextQuestion();
    return;
  }
  if (buzzed || !currentQuestion) return;
  buzzed = true;

  // stop the typing animation
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }

  // clear the reading timer
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }

  // bring up answer input
  const answerInput = document.getElementById("answer");
  document.getElementById("answer-section").style.display = "block";
  answerInput.disabled = false;
  answerInput.focus();

  // give 8 seconds to type answer or cooked
  startTimer(8, submitAnswer);
}

async function checkWithBackend(userAns, correctAns) {
  try {
    const res = await fetchWithFallback('/api/check-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAnswer: userAns,
        correctAnswer: correctAns
      })
    });
    
    const data = await res.json();
    return data.isCorrect;
  } catch (error) {
    console.error("Error checking answer:", error);
    return false;
  }
}

async function submitAnswer() {
  clearInterval(timerId);
  const userAns = document.getElementById("answer").value.trim();
  const correctAns = currentQuestion.parsed_answer || "";
  const category = currentQuestion.category || "Unknown";
  if (!scores[category]) scores[category] = { correct: 0, wrong: 0 };

  let isCorrect = false;
  if (currentQuestion.type.toLowerCase().includes("multiple")) {
    // for multiple choice: accept either the letter (A, B, C...) or full answer text
    const match = correctAns.match(/^([A-Z])[:\)]/);
    const correctLetter = match ? match[1].toUpperCase() : "";
    const correctText = correctAns.replace(/^[A-Z][:\)]/, "").trim().toUpperCase();

    const userUp = userAns.toUpperCase().trim();
    // Check if user entered just the letter or the full text
    isCorrect = userUp === correctLetter || userUp === correctText;
  } else {
    // Short answer: check for exact match first (case-insensitive)
    if (userAns.toLowerCase() === correctAns.toLowerCase()) {
      isCorrect = true;
    } else {
      // Not exact match, check with Gemini API
      isCorrect = await checkWithBackend(userAns, correctAns);
    }
  }

  if (isCorrect) {
    scores[category].correct++;
  } else {
    scores[category].wrong++;
  }
  updateScores();

  // Track answer submission in Google Analytics
  if (typeof gtag !== 'undefined') {
    gtag('event', 'answer_submitted', {
      'event_category': 'Answers',
      'event_label': category,
      'correct': isCorrect,
      'question_type': currentQuestion.type
    });
  }

  const resultsDiv = document.getElementById("results");
  
  // Fix over-escaped backslashes in question and answer
  const fixedQuestion = currentQuestion.parsed_question.replace(/\\\\/g, '\\');
  const fixedAnswer = correctAns.replace(/\\\\/g, '\\');
  
  const resultText = `Q: ${fixedQuestion}\nCorrect: ${fixedAnswer}\nYour Answer: ${userAns || "(none)"}\n${isCorrect ? "✅ Correct!" : "❌ Wrong!"}`;
  
  // Escape HTML and preserve newlines
  const escaped = resultText.replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\n/g, '<br>');
  resultsDiv.innerHTML = escaped;
  
  // Render LaTeX in results
  renderLatex(resultsDiv);

  document.getElementById("answer").disabled = true;
  waitingForNext = true;
}

async function nextQuestion() {
  // clear everything for new question
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  
  document.getElementById("results").textContent = "";
  document.getElementById("answer").value = "";
  document.getElementById("answer").disabled = true;
  document.getElementById("answer-section").style.display = "none";
  buzzed = false;
  waitingForNext = false;

  // get selected categories
  const selectedCats = getSelectedCategories();
  if (selectedCats.length === 0) {
    document.getElementById("question").textContent = "Please select at least one category!";
    return;
  }

  try {
    // Request ONE question from backend with fallback
    const res = await fetchWithFallback('/api/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: selectedCats })
    });

    const data = await res.json();
    currentQuestion = data.question;

    // Track question request in Google Analytics
    if (typeof gtag !== 'undefined') {
      gtag('event', 'question_requested', {
        'event_category': 'Questions',
        'event_label': currentQuestion.category,
        'question_type': currentQuestion.type
      });
    }

    // format the full question text
    const questionType = currentQuestion.type || "Unknown";
    const fullText = `TYPE: ${questionType}\nCATEGORY: ${currentQuestion.category}\n\n${currentQuestion.parsed_question}`;

    // start the typing animation
    showQuestion(fullText);
  } catch (error) {
    console.error("Error fetching question:", error);
    document.getElementById("question").textContent = "Error loading question from all servers. Check your connection.";
  }
}

// spacebar to buzz, but not when typing in answer box (this needs to be outside DOMContentLoaded)
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    if (document.activeElement.id === "answer") {
      return; // let them type spaces normally
    }
    e.preventDefault();
    buzz();
  }
});

// Auto-render LaTeX on page load and setup event listeners
document.addEventListener("DOMContentLoaded", function() {
  renderLatex(document.body);
  
  document.getElementById("start").addEventListener("click", async () => {
    updateScores();
    nextQuestion();
  });

  document.getElementById("load-categories").addEventListener("click", async () => {
    await loadCategories();
  });

  document.getElementById("submit").addEventListener("click", submitAnswer);
  
  document.getElementById("answer").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAnswer();
    }
  });

  document.getElementById("space-btn").addEventListener("click", () => {
    buzz();
  });
});
