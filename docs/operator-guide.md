# Руководство оператора

## Перед сменой

Проверьте:

- media-service показывает `ACTIVE` и версия совпадает с интерфейсом;
- PostgreSQL health = `ready`;
- media, graphics, fonts и network shares доступны сервисному пользователю;
- выбран правильный Current/Future;
- на резервном приёмнике видны видео и звук;
- PID/service metadata согласованы с головной станцией;
- свободное место есть для logs и preview cache.

Красный или жёлтый индикатор нельзя закрывать «по привычке»: сначала прочитайте
сообщение и проверьте output вне FluxIO.

## 1. Import & Analyze

Добавьте отдельные files, каталог или `.air/.txt`. Дождитесь ffprobe:

- Done/Analyzed — файл можно ставить в эфир;
- Pending/Queued — анализ не закончен;
- Error — путь, codec или права нужно исправить.

Импорт расписания создаёт Current либо Future. Проверяйте encoding,
`start on`, delay, warnings и недельное покрытие. Warning о типе
`movie/chop/clip` не блокирует работу, недоступный media file блокирует
production start.

## 2. Effects

Библиотека содержит file effects и broadcast effects второго уровня.

Для каждого broadcast effect:

1. задайте понятное имя;
2. заполните обязательные поля;
3. выберите scene или file decoration;
4. проверьте preview в реальной target layout;
5. назначьте clip, весь project или JSON task;
6. после правки существующего эффекта нажмите применение изменений к уже
   назначенным clips.

Незавершённый эффект остаётся видимым, но назначить его нельзя. Порядок
библиотеки определяет порядок наложения; не используйте сортировку по имени.

## 3. Playlist & Preview

В Current/Future можно:

- выбирать стартовый clip;
- переставлять и удалять clips;
- менять тип строки;
- включать AGE, logo, FX и SRT;
- задавать In/Out graphic layers;
- назначать дополнительные audio tracks;
- сохранять отредактированное расписание;
- запускать composite preview.

`Ctrl/Cmd + click` набирает отдельные clips, `Shift + click` — диапазон,
`Ctrl/Cmd + A` — весь активный список. Групповое перемещение сохраняет порядок.

### Start here и Take on air

- **Start here** запоминает clip, с которого начнётся следующий Start.
- **Take on air** во время эфира делает preflight нового среза и управляемо
  перезапускает playout с выбранного clip.

Take не является бесшовным transition: возможен короткий разрыв transport.

### HOT CHANGE

Изменения будущих clips отправляются в media-service без перезапуска encoder.
Текущий уже кодируемый clip не меняется задним числом. После подтверждения
проверьте, что следующий clip и его graphics действительно появились на
monitor preview.

## 4. Broadcast Settings

Настройте:

- codec, resolution, frame rate, field order и hardware;
- GOP, B-frames и rate control;
- audio codec/channels/bitrate/loudness;
- UDP, SRT или RTMP(S);
- MPEG-TS service metadata, PID, PCR и bitrate;
- subtitle output;
- SCTE-35.

Импортированный encoding profile не содержит secrets. После импорта заново
введите SRT passphrase или RTMP key и проверьте local interface.

## 5. Preview и Start

До Start:

1. откройте composite preview проблемного clip;
2. проверьте aspect, interlace, logo, AGE, FX, titles и captions;
3. прослушайте все заявленные языки;
4. проверьте следующий clip и границу;
5. запустите на тестовый endpoint;
6. измерьте transport на независимом приёмнике.

После Start следите за:

- state = running;
- текущим clip и временем;
- fps/speed около реального времени;
- audio meter;
- output bitrate;
- continuity errors;
- SCTE-35/DVB status;
- logs без повторяющихся restart/error.

## 6. Current → Future и Repeat

Если Repeat выключен, после завершения Current Future становится активным
автоматически. Если Future пуст, дальнейшее поведение определяется
подготовленным playout request; не рассчитывайте на UI как на scheduler.

Repeat запускает Current заново. Стратегия SCTE-35 Event ID должна быть заранее
согласована: increment создаёт новые IDs на каждом круге, reuse повторяет IDs.

## 7. Stop

Используйте штатную кнопку Stop и дождитесь idle/completed. Только затем:

- закрывайте service;
- обновляйте приложение;
- меняйте endpoint, PID или hardware profile;
- выключайте компьютер.

Закрытие Electron window не равно Stop, если media-service работает фоном.

## 8. Save и recovery

Workspace сохраняется автоматически после изменений, но перед обновлением,
аварийным тестом или концом смены нажмите явное сохранение. Оно включает Current,
Future, effects, settings и start marker; media files не копируются.

После аварии:

1. откройте восстановленную сессию;
2. проверьте missing files;
3. сравните checkpoint clip/time;
4. выберите Resume только после проверки endpoint;
5. контролируйте первый кадр и звук на внешнем monitor.

## Чего не делать

- Не публиковать API в LAN для «удобства».
- Не менять PID во время running session.
- Не считать HLS preview доказательством корректного PCR/continuity.
- Не удалять source file после назначения.
- Не полагаться на software encoding для UHD без измеренного запаса.
- Не игнорировать version mismatch UI/service.
- Не применять JSON task с нулём совпадений: сначала исправьте match key.
