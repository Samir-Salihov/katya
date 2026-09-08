// ═══ RANDOM MEMORY ═══
const memories = [
  { emoji: '🎬', text: 'Помнишь, как мы смотрели «Последний Богатырь» с огромным ведром попкорна? Ты смеялась громче всех в зале.' },
  { emoji: '❤️', text: 'Тот поцелуй в зеркале Сити Молла. Случайный — и самый настоящий.' },
  { emoji: '🎨', text: 'Когда мы лепили из глины и у нас получилось... ну, что-то с глазами и розовым ртом. Наш шедевр.' },
  { emoji: '💤', text: 'Как мы засыпали рядом — и мне было так спокойно, что время просто остановилось.' },
  { emoji: '📸', text: 'Наши селфи в лифте. Ты делала утиные губки, а я пытался выглядеть серьёзно.' },
  { emoji: '☕', text: 'Рабочие дни вместе. Когда я оборачивался — а ты уже смотришь и улыбаешься.' },
  { emoji: '🤸', text: 'Как ты подкрадывалась и фоткала меня, когда я даже не знал. А потом показывала с таким гордым лицом.' },
  { emoji: '🌅', text: 'Прогулки, которые должны были быть на 20 минут, но растягивались на весь вечер.' },
  { emoji: '👫', text: 'Наши сердечки руками. Сколько мы их сделали? Сто? Тысячу?' },
  { emoji: '💋', text: 'Тот нежный поцелуй в лоб. Когда слов не нужно — всё и так понятно.' },
];
let lastMem = -1;
function randomMemory() {
  let idx;
  do { idx = Math.floor(Math.random() * memories.length); } while (idx === lastMem);
  lastMem = idx;
  const card = document.getElementById('memCard');
  card.classList.remove('flip');
  void card.offsetWidth;
  card.classList.add('flip');
  setTimeout(() => {
    document.getElementById('memEmoji').textContent = memories[idx].emoji;
    document.getElementById('memText').textContent = memories[idx].text;
  }, 300);
}
