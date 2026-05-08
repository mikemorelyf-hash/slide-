import type { SupportedLanguageCode } from '../domain/language.js';
import type { PassengerManifest, RidePool, Route, TelegramUserProfile } from '../domain/types.js';

const botCopy = {
  en: {
    acceptEarlyDispatch: 'Accept Early Dispatch',
    acceptJob: 'Accept Job',
    actionExpired: 'Your saved action expired. Please choose a route again.',
    activePoolExistsJoin: 'You already have an active pool. Finish or cancel that one before joining another.',
    activePoolExistsStart: 'You already have an active pool. Finish or cancel that one before starting another.',
    alreadyProcessing: 'Already processing. Please wait.',
    arrivalNotAvailable: 'Arrival request is not available for this job.',
    arrivalRequestSentCallback: 'Arrival request sent.',
    backToRoutes: 'Back to Routes',
    cancel: 'Cancel',
    confirmArrival: 'Confirm Arrival',
    createPool: 'Create Pool',
    driverArrivalNotConfirmed: 'Driver arrival was not confirmed. The 10-minute driver timer is still active.',
    driverBotReady:
      'Driver bot ready.\nYou can accept jobs from the driver group.\nAfter a trip, send the 4-digit PIN here.',
    driverNotHere: 'Driver Not Here',
    earlyNotAvailable: 'Early dispatch is not available for this pool right now.',
    earlyRejected: 'You rejected early dispatch.',
    earlyVoteSaved: 'Your early dispatch vote was saved.',
    genericError: 'Sorry, something went wrong. Please try again.',
    iArrived: 'I Arrived',
    iHavePaid: 'I Have Paid',
    invalidPin: 'Invalid PIN. Please check with the passengers and try again.',
    jobAccepted: 'You accepted the job.',
    jobTaken: 'Sorry, this job has already been taken.',
    joinPool: 'Join Pool',
    languageAmharic: 'አማርኛ',
    languageEnglish: 'English',
    languageMenu: 'Choose your language for Side.',
    languageMenuButton: 'Language / ቋንቋ',
    languageUpdatedAm: 'Language set to Amharic.',
    languageUpdatedEn: 'Language set to English.',
    letGoNow: "Let's Go Now",
    noActivePool: 'You do not have an active pool right now.',
    noCancellablePool:
      'No cancellable pool was found. If a driver already accepted, please coordinate with the driver/admin.',
    noRoutesConfigured: 'No routes are configured yet. Add ROUTES in env and restart the backend.',
    openBotFirst: 'Open the bot first, then try again.',
    openDriverBotFirst: 'Open the driver bot first, then try again.',
    openPassengerApp: 'Open Passenger App',
    pendingPaymentNotFound: 'No pending payment was found for this pool.',
    phoneSaved: 'Phone number saved.',
    phoneSavedContinuing: 'Phone number saved. Continuing to payment.',
    pickupNotNeeded: 'Pickup location is not needed. Please share your phone number instead.',
    poolAlreadyLeft: 'Sorry, that pool already left. Please choose another pool.',
    poolNoLongerAvailable: 'Sorry, this pool is no longer available.',
    poolParticipationCancelled: 'Your pool participation was cancelled before dispatch.',
    reject: 'Reject',
    routeNotAvailable: 'That route is not available right now.',
    routePriceNotSet: 'That route price is not set yet. Please choose another route.',
    routePriceUnsetChoose: 'That route price is not set yet. Please choose a route with a price.',
    savePhoneFirst: 'Tap Share Phone below. I will continue to payment automatically after it is saved.',
    shareOwnPhone: 'Please share your own phone number.',
    sharePhone: 'Share Phone',
    skipForNow: 'Skip for now',
    skipProfileLater: 'No problem. You can update your profile later with /profile.',
    usageComplete: 'Usage: /complete 4334'
  },
  am: {
    acceptEarlyDispatch: 'ቀድሞ መላክን ተቀበል',
    acceptJob: 'ስራውን ተቀበል',
    actionExpired: 'የተቀመጠው እርምጃ ጊዜው አልፏል። እባክዎ መንገድ እንደገና ይምረጡ።',
    activePoolExistsJoin: 'አሁን ንቁ ፑል አለዎት። ሌላ ከመቀላቀልዎ በፊት ያንን ያጠናቁ ወይም ይሰርዙ።',
    activePoolExistsStart: 'አሁን ንቁ ፑል አለዎት። ሌላ ከመጀመርዎ በፊት ያንን ያጠናቁ ወይም ይሰርዙ።',
    alreadyProcessing: 'በሂደት ላይ ነው። እባክዎ ይጠብቁ።',
    arrivalNotAvailable: 'የመድረስ ጥያቄ ለዚህ ስራ አይገኝም።',
    arrivalRequestSentCallback: 'የመድረስ ጥያቄ ተልኳል።',
    backToRoutes: 'ወደ መንገዶች ተመለስ',
    cancel: 'ሰርዝ',
    confirmArrival: 'መድረስ አረጋግጥ',
    createPool: 'ፑል ፍጠር',
    driverArrivalNotConfirmed: 'የሾፌሩ መድረስ አልተረጋገጠም። የ10 ደቂቃ ሰዓት አሁንም እየቆጠረ ነው።',
    driverBotReady:
      'የሾፌር ቦት ዝግጁ ነው።\nከሾፌሮች ግሩፕ ስራዎችን መቀበል ይችላሉ።\nጉዞ ከተጠናቀቀ በኋላ የ4 አሃዝ PIN እዚህ ይላኩ።',
    driverNotHere: 'ሾፌሩ እዚህ የለም',
    earlyNotAvailable: 'ቀድሞ መላክ ለዚህ ፑል አሁን አይገኝም።',
    earlyRejected: 'ቀድሞ መላክን አልተቀበሉም።',
    earlyVoteSaved: 'የቀድሞ መላክ ድምጽዎ ተቀምጧል።',
    genericError: 'ይቅርታ፣ አንድ ችግኝ ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።',
    iArrived: 'ደርሻለሁ',
    iHavePaid: 'ከፍያለሁ',
    invalidPin: 'PIN ትክክል አይደለም። እባክዎ ከተሳፋሪዎች ጋር ያረጋግጡና እንደገና ይሞክሩ።',
    jobAccepted: 'ስራውን ተቀብለዋል።',
    jobTaken: 'ይቅርታ፣ ይህ ስራ ቀድሞ ተወስዷል።',
    joinPool: 'ፑል ተቀላቀል',
    languageAmharic: 'አማርኛ',
    languageEnglish: 'English',
    languageMenu: 'ለSide ቋንቋ ይምረጡ።',
    languageMenuButton: 'ቋንቋ / Language',
    languageUpdatedAm: 'ቋንቋ ወደ አማርኛ ተቀይሯል።',
    languageUpdatedEn: 'ቋንቋ ወደ English ተቀይሯል።',
    letGoNow: 'አሁን እንሂድ',
    noActivePool: 'አሁን ንቁ ፑል የለዎትም።',
    noCancellablePool:
      'ሊሰረዝ የሚችል ፑል አልተገኘም። ሾፌር ከተቀበለ እባክዎ ከሾፌሩ/አድሚን ጋር ይዋቀሩ።',
    noRoutesConfigured: 'መንገዶች እስካሁን አልተዘጋጁም። ROUTES በenv ያክሉና backend እንደገና ያስጀምሩ።',
    openBotFirst: 'መጀመሪያ ቦቱን ይክፈቱ፣ ከዚያ እንደገና ይሞክሩ።',
    openDriverBotFirst: 'መጀመሪያ የሾፌር ቦቱን ይክፈቱ፣ ከዚያ እንደገና ይሞክሩ።',
    openPassengerApp: 'የተሳፋሪ መተግበሪያ ክፈት',
    pendingPaymentNotFound: 'ለዚህ ፑል በመጠባበቅ ላይ ያለ ክፍያ አልተገኘም።',
    phoneSaved: 'ስልክ ቁጥር ተቀምጧል።',
    phoneSavedContinuing: 'ስልክ ቁጥር ተቀምጧል። ወደ ክፍያ እቀጥላለሁ።',
    pickupNotNeeded: 'የመነሻ ቦታ አያስፈልግም። እባክዎ በምትኩ ስልክ ቁጥርዎን ያጋሩ።',
    poolAlreadyLeft: 'ይቅርታ፣ ያ ፑል ቀድሞ ሄዷል። እባክዎ ሌላ ፑል ይምረጡ።',
    poolNoLongerAvailable: 'ይቅርታ፣ ይህ ፑል ከእንግዲህ አይገኝም።',
    poolParticipationCancelled: 'በፑሉ ውስጥ ያለዎት ተሳትፎ ከመላክ በፊት ተሰርዟል።',
    reject: 'አትቀበል',
    routeNotAvailable: 'ያ መንገድ አሁን አይገኝም።',
    routePriceNotSet: 'የዚያ መንገድ ዋጋ እስካሁን አልተዘጋጀም። እባክዎ ሌላ መንገድ ይምረጡ።',
    routePriceUnsetChoose: 'የዚያ መንገድ ዋጋ እስካሁን አልተዘጋጀም። እባክዎ ዋጋ ያለው መንገድ ይምረጡ።',
    savePhoneFirst: 'ከታች ስልክ አጋራ ይጫኑ። ከተቀመጠ በኋላ ወደ ክፍያ እቀጥላለሁ።',
    shareOwnPhone: 'እባክዎ የራስዎን ስልክ ቁጥር ያጋሩ።',
    sharePhone: 'ስልክ አጋራ',
    skipForNow: 'ለአሁን ዝለል',
    skipProfileLater: 'ችግኝ የለም። በኋላ /profile በመጠቀም መገለጫዎን ማዘመን ይችላሉ።',
    usageComplete: 'አጠቃቀም: /complete 4334'
  }
} as const;

export type BotCopyKey = keyof typeof botCopy.en;

export function botLabel(key: BotCopyKey, language: SupportedLanguageCode = 'en'): string {
  return (botCopy[language] as Record<BotCopyKey, string>)[key] ?? botCopy.en[key];
}

export function routeIntroMessage(language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? 'መንገድ ይምረጡ፤ የጋራ ጉዞ ፑል ለማግኘት ወይም ለመፍጠር።'
    : 'Choose a route to find or create a ride pool.';
}

export function openPoolMessage(pool: RidePool, poolSize: number, language: SupportedLanguageCode = 'en'): string {
  if (language === 'am') {
    return [
      `ለ${pool.routeName} ክፍት ፑል ተገኝቷል።`,
      `የተረጋገጡ ተሳፋሪዎች: ${pool.passengerCount}/${poolSize}`,
      'መቀመጫዎን ለማስያዝ ፑል ተቀላቀል ይጫኑ፣ ከዚያ ክፍያዎን ያረጋግጡ።'
    ].join('\n');
  }

  return [
    `Open pool found for ${pool.routeName}.`,
    `Passengers confirmed: ${pool.passengerCount}/${poolSize}`,
    'Tap Join Pool to reserve your seat, then confirm payment.'
  ].join('\n');
}

export function noOpenPoolMessage(routeName: string, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [`ለ${routeName} ንቁ ፑል አልተገኘም።`, 'አዲስ ፑል መፍጠር እና ካፒቴን መሆን ይችላሉ።'].join('\n')
    : [`No active pool available for ${routeName}.`, 'You can create one and become captain.'].join(
        '\n'
      );
}

export function paymentPromptMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  if (language === 'am') {
    return [
      `ፑል ${pool.routeName}`,
      `ዋጋ: ${formatPrice(pool, language)}`,
      '',
      'የMVP ክፍያ ዘዴ: በእጅ ማረጋገጥ።',
      'ክፍያዎን ከጨረሱ በኋላ ከፍያለሁ ይጫኑ።',
      'የተረጋገጠ የፑል ዝርዝርዎ ክፍያ ከተረጋገጠ በኋላ ብቻ ይላካል።'
    ].join('\n');
  }

  return [
    `Pool ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    '',
    'Payment method for MVP: manual confirmation.',
    'Tap I Have Paid after you complete payment.',
    'Your confirmed pool details will be sent only after payment is confirmed.'
  ].join('\n');
}

export function passengerConfirmedMessage(
  pool: RidePool,
  passengerCount: number,
  poolSize: number,
  language: SupportedLanguageCode = 'en'
): string {
  if (language === 'am') {
    return [
      'ክፍያ ተረጋግጧል።',
      `መንገድ: ${pool.routeName}`,
      `ዋጋ: ${formatPrice(pool, language)}`,
      `የፑል PIN: ${pool.pinCode}`,
      `የተረጋገጡ ተሳፋሪዎች: ${passengerCount}/${poolSize}`,
      `ሾፌሮች ስራውን ${poolSize}/${poolSize} መቀመጫዎች ሲረጋገጡ ወይም አሁን እንሂድ ሲፈቀድ ያያሉ።`,
      'ፑሉ ዝግጁ ሲሆን መልዕክት ይደርስዎታል።'
    ].join('\n');
  }

  return [
    'Payment confirmed.',
    `Route: ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    `Pool PIN: ${pool.pinCode}`,
    `Passengers confirmed: ${passengerCount}/${poolSize}`,
    `Drivers will see the job when ${poolSize}/${poolSize} seats are confirmed or when Let's Go Now is approved.`,
    'You will be notified when the pool is ready.'
  ].join('\n');
}

export function poolReadyPassengerMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  if (language === 'am') {
    return [
      pool.isEarlyDispatch ? 'የቀድሞ መላክ ፑልዎ ዝግጁ ነው።' : 'ፑልዎ ዝግጁ ነው።',
      `መንገድ: ${pool.routeName}`,
      `የፑል PIN: ${pool.pinCode}`,
      'ለሾፌሮች ማሳወቂያ ተልኳል። ሾፌር ሲቀበል መልዕክት ይደርስዎታል።'
    ].join('\n');
  }

  return [
    pool.isEarlyDispatch ? 'Your early dispatch pool is ready.' : 'Your pool is ready.',
    `Route: ${pool.routeName}`,
    `Pool PIN: ${pool.pinCode}`,
    'A driver alert has been sent. You will be notified when a driver accepts.'
  ].join('\n');
}

export function driverGroupAlertMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  if (language === 'am') {
    if (pool.isEarlyDispatch) {
      return [
        'ቀድሞ የሚላክ የጋራ ጉዞ ፑል',
        '',
        `መንገድ: ${pool.routeName}`,
        `ተሳፋሪዎች: ${pool.passengerCount}`,
        'ሁኔታ: ቀድሞ መላክ',
        '',
        'ከጉዞ በኋላ ከተሳፋሪዎች የፑል PIN ይጠይቁ።',
        'ለቀድሞ መላክ የተስማሙበትን ተጨማሪ ጥሬ ገንዘብ ይሰብስቡ።',
        '',
        'መጀመሪያ የሚቀበል ሾፌር ስራውን ያገኛል።'
      ].join('\n');
    }

    return [
      'አዲስ የጋራ ጉዞ ፑል ይገኛል',
      '',
      `መንገድ: ${pool.routeName}`,
      `ተሳፋሪዎች: ${pool.passengerCount}`,
      'ሁኔታ: ዝግጁ',
      '',
      'መጀመሪያ የሚቀበል ሾፌር ስራውን ያገኛል።'
    ].join('\n');
  }

  if (pool.isEarlyDispatch) {
    return [
      'Early Dispatch Ride Pool',
      '',
      `Route: ${pool.routeName}`,
      `Passengers: ${pool.passengerCount}`,
      'Status: Early Dispatch',
      '',
      'Ask passengers for the pool PIN after the trip.',
      'Collect the additional cash agreed for early dispatch.',
      '',
      'First driver to accept gets the job.'
    ].join('\n');
  }

  return [
    'New Ride Pool Available',
    '',
    `Route: ${pool.routeName}`,
    `Passengers: ${pool.passengerCount}`,
    'Status: Ready',
    '',
    'First driver to accept gets the job.'
  ].join('\n');
}

export function driverAssignedGroupMessage(
  pool: RidePool,
  driverLabel: string,
  language: SupportedLanguageCode = 'en'
): string {
  return language === 'am'
    ? [`ስራው በ${driverLabel} ተወስዷል።`, '', `መንገድ: ${pool.routeName}`, 'እባክዎ በቅርቡ ሌላ ስራ ይጠብቁ።'].join('\n')
    : [
        `Job taken by ${driverLabel}.`,
        '',
        `Route: ${pool.routeName}`,
        'Please wait for another job soon.'
      ].join('\n');
}

export function driverManifestMessage(
  pool: RidePool,
  manifest: PassengerManifest[],
  language: SupportedLanguageCode = 'en'
): string {
  const passengerLines = manifest.map((passenger, index) => {
    const lines =
      language === 'am'
        ? [`${index + 1}. ${passenger.displayName}`, `Telegram ID: ${passenger.telegramId}`]
        : [`${index + 1}. ${passenger.displayName}`, `Telegram ID: ${passenger.telegramId}`];

    if (passenger.username) {
      lines.push(language === 'am' ? `Username: @${passenger.username}` : `Username: @${passenger.username}`);
    }
    if (passenger.phoneNumber) {
      lines.push(language === 'am' ? `ስልክ: ${passenger.phoneNumber}` : `Phone: ${passenger.phoneNumber}`);
    }

    return lines.join('\n');
  });

  if (language === 'am') {
    return [
      'ይህን የጋራ ጉዞ ፑል ተቀብለዋል።',
      pool.isEarlyDispatch
        ? 'ማስታወሻ: ይህ ቀድሞ የሚላክ ጉዞ ነው። የተስማሙበትን ተጨማሪ ጥሬ ገንዘብ ከተሳፋሪዎች ይሰብስቡ።'
        : '',
      '',
      `መንገድ: ${pool.routeName}`,
      `ተሳፋሪዎች: ${manifest.length}`,
      '',
      passengerLines.join('\n\n'),
      '',
      'ወደ ተሳፋሪዎች ሲደርሱ ደርሻለሁ ይጫኑ።',
      'ከጉዞ በኋላ ከተሳፋሪዎች የ4 አሃዝ PIN ይጠይቁና እዚህ ይላኩ።'
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  return [
    'You accepted this ride pool.',
    pool.isEarlyDispatch
      ? 'Reminder: this is an early dispatch ride. Collect the agreed additional cash from passengers.'
      : '',
    '',
    `Route: ${pool.routeName}`,
    `Passengers: ${manifest.length}`,
    '',
    passengerLines.join('\n\n'),
    '',
    'Tap I Arrived when you reach the passengers.',
    'After the trip, ask passengers for the 4-digit PIN and send it here.'
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function passengerDriverAssignedMessage(
  pool: RidePool,
  driver: TelegramUserProfile,
  language: SupportedLanguageCode = 'en'
): string {
  const lines =
    language === 'am'
      ? [
          'ሾፌር ጉዞዎን ተቀብሏል።',
          '',
          `መንገድ: ${pool.routeName}`,
          `የፑል PIN: ${pool.pinCode}`,
          `ሾፌር: ${formatProfileName(driver)}`
        ]
      : [
          'A driver accepted your trip.',
          '',
          `Route: ${pool.routeName}`,
          `Pool PIN: ${pool.pinCode}`,
          `Driver: ${formatProfileName(driver)}`
        ];

  if (driver.username) {
    lines.push(`Telegram: @${driver.username}`);
  }
  if (driver.phoneNumber) {
    lines.push(language === 'am' ? `ስልክ: ${driver.phoneNumber}` : `Phone: ${driver.phoneNumber}`);
  }

  return lines.join('\n');
}

export function driverArrivalRequestCaptainMessage(
  pool: RidePool,
  driver: TelegramUserProfile,
  language: SupportedLanguageCode = 'en'
): string {
  const lines =
    language === 'am'
      ? [
          'ሾፌሩ ደርሻለሁ ብሏል።',
          '',
          `መንገድ: ${pool.routeName}`,
          `ሾፌር: ${formatProfileName(driver)}`,
          '',
          'መጀመሪያ ይህ ለካፒቴኑ ይደርሳል፤ ካፒቴኑ ካልተገኘ ማንኛውም የተረጋገጠ ተሳፋሪ ማረጋገጥ ይችላል።'
        ]
      : [
          'Driver says they arrived.',
          '',
          `Route: ${pool.routeName}`,
          `Driver: ${formatProfileName(driver)}`,
          '',
          'The captain gets this first, but any confirmed passenger can confirm if the captain is unavailable.'
        ];

  if (driver.username) {
    lines.splice(4, 0, `Telegram: @${driver.username}`);
  }
  if (driver.phoneNumber) {
    lines.splice(driver.username ? 5 : 4, 0, language === 'am' ? `ስልክ: ${driver.phoneNumber}` : `Phone: ${driver.phoneNumber}`);
  }

  return lines.join('\n');
}

export function driverArrivalRequestSentMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'የመድረስ ጥያቄ ለተሳፋሪዎች ተልኳል።',
        `መንገድ: ${pool.routeName}`,
        'ጉዞውን ከመጀመርዎ በፊት የተረጋገጠ ተሳፋሪ መድረስዎን እንዲያረጋግጥ ይጠብቁ።'
      ].join('\n')
    : [
        'Arrival request sent to the passengers.',
        `Route: ${pool.routeName}`,
        'Wait for a confirmed passenger to approve arrival before starting the trip.'
      ].join('\n');
}

export function driverArrivalConfirmedPassengerMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? ['የሾፌሩ መድረስ ተረጋግጧል።', `መንገድ: ${pool.routeName}`, 'አሁን ጉዞውን መጀመር ይችላሉ።'].join('\n')
    : ['Driver arrival confirmed.', `Route: ${pool.routeName}`, 'You can start the trip now.'].join('\n');
}

export function driverArrivalConfirmedDriverMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'መድረስዎ በተሳፋሪ ተረጋግጧል።',
        `መንገድ: ${pool.routeName}`,
        'አሁን ጉዞውን ይጀምሩ። ከጉዞ በኋላ የ4 አሃዝ PIN እዚህ ይላኩ።'
      ].join('\n')
    : [
        'Arrival confirmed by a passenger.',
        `Route: ${pool.routeName}`,
        'Start the trip now. After the trip, send the 4-digit PIN here.'
      ].join('\n');
}

export function driverArrivalRejectedDriverMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'ተሳፋሪ መድረስዎን አላረጋገጠም።',
        `መንገድ: ${pool.routeName}`,
        'እባክዎ ከተሳፋሪዎች ጋር ይዋቀሩ፣ ሲደርሱም ደርሻለሁ እንደገና ይጫኑ።'
      ].join('\n')
    : [
        'A passenger did not confirm your arrival.',
        `Route: ${pool.routeName}`,
        'Please coordinate with the passengers and tap I Arrived again when you reach them.'
      ].join('\n');
}

export function profilePromptMessage(language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? 'ስልክ ቁጥርዎን ያጋሩ። ፑልዎ ሲመደብ ሾፌሮች እንዲያገኙዎት የTelegram መገለጫዎ በራሱ ይቀመጣል።'
    : 'Share your phone number. Your Telegram profile is saved automatically so drivers can contact you when your pool is assigned.';
}

export function profileStatusMessage(
  profile: TelegramUserProfile | null,
  language: SupportedLanguageCode = 'en'
): string {
  if (!profile) {
    return language === 'am' ? 'እስካሁን የተቀመጠ መገለጫ የለም።' : 'No profile saved yet.';
  }

  return language === 'am'
    ? [
        'መገለጫ',
        `ስልክ: ${profile.phoneNumber ?? 'አልተጋራም'}`,
        `Telegram: ${formatTelegramProfile(profile)}`
      ].join('\n')
    : [
        'Profile',
        `Phone: ${profile.phoneNumber ?? 'not shared'}`,
        `Telegram: ${formatTelegramProfile(profile)}`
      ].join('\n');
}

export function earlyDispatchRequestMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'የፑሉ ካፒቴን ቀድሞ መላክ ይፈልጋል።',
        '',
        `መንገድ: ${pool.routeName}`,
        `አሁን ያሉ ተሳፋሪዎች: ${pool.passengerCount}`,
        '',
        'ቀድሞ መላክን ይቀበላሉ?'
      ].join('\n')
    : [
        'The pool captain wants to dispatch early.',
        '',
        `Route: ${pool.routeName}`,
        `Current passengers: ${pool.passengerCount}`,
        '',
        'Do you accept early dispatch?'
      ].join('\n');
}

export function earlyDispatchStartedMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'የቀድሞ መላክ ጥያቄ ተልኳል።',
        `መንገድ: ${pool.routeName}`,
        'አሁን ያሉ ተሳፋሪዎች ሁሉ ከተቀበሉ፣ ይህ ፑል ለሾፌሮች ይላካል።'
      ].join('\n')
    : [
        'Early dispatch request sent.',
        `Route: ${pool.routeName}`,
        'If all current passengers accept, this pool will be sent to drivers.'
      ].join('\n');
}

export function earlyDispatchCancelledMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [`ለ${pool.routeName} የቀድሞ መላክ ጥያቄ ተሰርዟል።`, 'ፑሉ መጠበቁን ይቀጥላል።'].join('\n')
    : [`Early dispatch was cancelled for ${pool.routeName}.`, 'The pool will keep waiting.'].join('\n');
}

export function myPoolMessage(
  pool: RidePool,
  isCaptain: boolean,
  poolSize: number,
  language: SupportedLanguageCode = 'en'
): string {
  if (language === 'am') {
    return [
      'የአሁኑ ፑል',
      `መንገድ: ${pool.routeName}`,
      `ዋጋ: ${formatPrice(pool, language)}`,
      `PIN: ${pool.pinCode}`,
      `ተሳፋሪዎች: ${pool.passengerCount}/${poolSize}`,
      `ሁኔታ: ${pool.status}`,
      isCaptain ? 'ሚና: ካፒቴን ተሳፋሪ' : 'ሚና: ተሳፋሪ'
    ].join('\n');
  }

  return [
    'Current Pool',
    `Route: ${pool.routeName}`,
    `Price: ${formatPrice(pool)}`,
    `PIN: ${pool.pinCode}`,
    `Passengers: ${pool.passengerCount}/${poolSize}`,
    `Status: ${pool.status}`,
    isCaptain ? 'Role: captain passenger' : 'Role: passenger'
  ].join('\n');
}

export function tripCompletedPassengerMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'እንኳን ደስ አለዎት፣ ጉዞዎ ተጠናቋል።',
        `መንገድ: ${pool.routeName}`,
        'ከSide ጋር በጋራ ስለተጓዙ እናመሰግናለን።',
        'በጋራ በመጓዝ ቆጥበዋል።'
      ].join('\n')
    : [
        'Congrats, your ride is complete.',
        `Route: ${pool.routeName}`,
        'Thanks for riding together with Side.',
        'You saved by pooling.'
      ].join('\n');
}

export function tripCompletedDriverMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'እንኳን ደስ አለዎት፣ ጉዞው ተጠናቋል።',
        `መንገድ: ${pool.routeName}`,
        'የSide ጉዞን ስላጠናቀቁ እናመሰግናለን።',
        'ለክፍያ አድሚን ተነግሯል።'
      ].join('\n')
    : [
        'Congrats, trip completed.',
        `Route: ${pool.routeName}`,
        'Thanks for completing this Side ride.',
        'Admin has been notified for payout.'
      ].join('\n');
}

export function repostedDriverAlertMessage(pool: RidePool, language: SupportedLanguageCode = 'en'): string {
  return language === 'am'
    ? [
        'ስራ እንደገና ተለጥፏል',
        '',
        'ቀድሞው ሾፌር በጊዜው አልደረሰም።',
        '',
        `መንገድ: ${pool.routeName}`,
        `ተሳፋሪዎች: ${pool.passengerCount}`,
        '',
        'መጀመሪያ የሚቀበል ሾፌር ስራውን ያገኛል።'
      ].join('\n')
    : [
        'Job Reposted',
        '',
        'The previous driver did not arrive on time.',
        '',
        `Route: ${pool.routeName}`,
        `Passengers: ${pool.passengerCount}`,
        '',
        'First driver to accept gets the job.'
      ].join('\n');
}

export function adminPoolSummary(pool: RidePool): string {
  return [
    `#${pool.id} ${pool.routeName}`,
    `status=${pool.status}`,
    `passengers=${pool.passengerCount}`,
    `price=${formatPrice(pool)}`,
    `pin=${pool.pinCode}`,
    pool.driverTelegramId ? `driver=${pool.driverTelegramId}` : 'driver=none',
    pool.isEarlyDispatch ? 'early_dispatch=true' : 'early_dispatch=false'
  ].join(' | ');
}

export function routeButtonLabel(route: Route, language: SupportedLanguageCode = 'en'): string {
  return `${route.name} - ${formatPrice(route, language)}`;
}

export function adminRouteSummary(route: Route): string {
  return [
    `#${route.id} ${route.name}`,
    `price=${formatPrice(route)}`,
    `active=${route.isActive}`
  ].join(' | ');
}

export function languageMenuMessage(language: SupportedLanguageCode = 'en'): string {
  return botLabel('languageMenu', language);
}

export function languageUpdatedMessage(language: SupportedLanguageCode): string {
  return language === 'am' ? botLabel('languageUpdatedAm', language) : botLabel('languageUpdatedEn', language);
}

export function formatPrice(
  price: Pick<Route | RidePool, 'priceAmount' | 'priceCurrency'>,
  language: SupportedLanguageCode = 'en'
): string {
  if (price.priceAmount === null) {
    return language === 'am' ? 'አልተዘጋጀም' : 'not set';
  }

  return `${formatAmount(price.priceAmount)} ${price.priceCurrency}`;
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function formatProfileName(profile: TelegramUserProfile): string {
  const fullName = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
  if (fullName) {
    return fullName;
  }

  if (profile.username) {
    return `@${profile.username}`;
  }

  return `Telegram ${profile.telegramId}`;
}

function formatTelegramProfile(profile: TelegramUserProfile): string {
  if (profile.username) {
    return `@${profile.username}`;
  }

  return formatProfileName(profile);
}
