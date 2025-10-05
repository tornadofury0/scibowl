// CONFIGURATION: Multiple backend URLs with automatic fallback
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

function showQuestion(q) {
  // Clear any existing typing interval first
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
  
  const qDiv = document.getElementById("question");
  qDiv.textContent = "";
  const speed = parseInt(document.getElementById("speed").value) || 50;
  let i = 0;
  typingInterval = setInterval(() => {
    if (i < q.length) {
      qDiv.textContent += q[i];
      i++;
    } else {
      clearInterval(typingInterval);
      startTimer(5, () => {
        if (!buzzed) {
          document.getElementById("results").textContent =
            "Time up! You did not buzz.";
          waitingForNext = true;
        }
      });
    }
  }, speed);
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
  tDiv.textContent = "⏱ " + timeLeft;
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
    const match = correctAns.match(/^[A-Z]\)/);
    const correctLetter = match ? match[0][0].toUpperCase() : "";
    const correctText = correctAns.replace(/^[A-Z]\)/, "").trim().toUpperCase();

    const userUp = userAns.toUpperCase();
    isCorrect = userUp.startsWith(correctLetter) || userUp === correctText;
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

  document.getElementById("results").textContent = `Q: ${
    currentQuestion.parsed_question
  }\nCorrect: ${correctAns}\nYour Answer: ${userAns || "(none)"}\n${
    isCorrect ? "✅ Correct!" : "❌ Wrong!"
  }`;

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

document.getElementById("start").addEventListener("click", async () => {
  updateScores();
  nextQuestion();
});

document.getElementById("load-categories").addEventListener("click", async () => {
  // loads categories from backend
  await loadCategories();
});

document.getElementById("submit").addEventListener("click", submitAnswer);
document.getElementById("answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // don't submit form
    submitAnswer();
  }
});

// spacebar to buzz, but not when typing in answer box
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    if (document.activeElement.id === "answer") {
      return; // let them type spaces normally
    }
    e.preventDefault();
    buzz();
  }
});

// space button acts like spacebar
document.getElementById("space-btn").addEventListener("click", () => {
  buzz();
});
