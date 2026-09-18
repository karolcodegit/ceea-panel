module.exports = ({ courseTitle, date, location, agendaUrl, firstName }) => `
  <h1>Witaj${firstName ? ` ${firstName}` : ""},</h1>
  <p>Przesyłamy szczegółowe informacje dotyczące kursu <strong>„${courseTitle}"</strong>.</p>
  <p><strong>Data:</strong> ${date}<br>
  <strong>Miejsce:</strong> ${location || "Poznań – szczegóły w panelu"}</p>
  ${agendaUrl ? `<p><a href="${agendaUrl}">Pobierz program kursu</a></p>` : ""}
  <p>Prosimy o punktualne przybycie. Rejestracja uczestników rozpoczyna się 30 minut przed wykładami.</p>
  <p>Pozdrawiamy,<br>Zespół CEEA Poznań</p>
`;