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


// Adapted from https://mui.com/material-ui/react-avatar/
export function stringAvatar(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (let i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }

  return {
    sx: {
      bgcolor: color,
    },
    children: name[0],
  };
}