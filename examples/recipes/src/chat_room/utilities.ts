const CHAT_NAME_KEY = '__electric_chat_username'

function generateRandomName() : string {
  const adjectives = ['Happy', 'Sunny', 'Playful', 'Mysterious', 'Gentle', 'Brave', 'Witty', 'Clever'];
  const nouns = ['Cat', 'Dog', 'Fox', 'Bear', 'Lion', 'Elephant', 'Tiger', 'Monkey'];

  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

  return `${randomAdjective} ${randomNoun}`;
}

export function generateAndPersistRandomName() : string {
  const cachedName = localStorage.getItem(CHAT_NAME_KEY)
  if (cachedName !== null) return cachedName
  const newName = generateRandomName()
  localStorage.setItem(CHAT_NAME_KEY, newName)
  return newName
}