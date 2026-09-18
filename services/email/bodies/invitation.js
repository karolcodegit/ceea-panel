module.exports = ({ courseTitle, courseNumber, date, location }) => `
  <h1>Szanowni Państwo,</h1>
  <p>mam przyjemność zaprosić Państwa do udziału w kolejnym kursie przygotowanym przez zespół CEEA Poznań. Kurs oznaczony numerem ${courseNumber || "6"} pod nazwą „<strong>${courseTitle}</strong>" odbędzie się w dniach <strong>${date}</strong> roku. Spotkamy się już tradycyjnie w ${location || "Hotelu Ilonn w Poznaniu"}.</p>
  <p>Udostępniliśmy już szczegółowy program kursu — zapraszamy niezmiennie pod adres: <a href="https://www.ceea.org.pl">www.ceea.org.pl</a>.</p>
  <p><strong>Z wyrazami szacunku</strong></p>
  <p><br></p>
  <p>Anna Kluzik<br>Dyrektor CEEA Poznań</p>
`;