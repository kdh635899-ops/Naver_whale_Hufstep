// 졸업평가 데이터의 논리·단위를 보존하는 표시(Model) 변환. 화면 컴포넌트는 기존 것을 쓴다.
import type { OfficialRule, StudentProfile } from '../types';
import { detailForGraduation, evaluateRules, type OfficialReport, type RuleEval } from './officialRules';
import { ASKABLE_FIELDS, type Cond, type DepartmentFacts } from './conditions';

const TYPES: Record<string, string> = {
  languageTest: '어학시험', testScore: '시험 성적', departmentExam: '학과 졸업시험', departmentLanguageScore: '학과 어학성적',
  departmentExamPassed: '학과 졸업시험 통과', departmentThesisPassed: '학과 졸업논문 통과', departmentInternalExam: '학과 자체시험',
  departmentAssessment: '학과 졸업평가', departmentAssessmentCandidate: '학과 졸업평가 · 확인 필요',
  commonLanguageCertification: '학교 외국어 인증', commonLanguageCertificationCandidate: '학교 외국어 인증 · 확인 필요',
  departmentLanguageRequirement: '학과 어학 요건', languageCertification: '어학 인증', languageCertificationAlternatives: '어학 인증',
  approvedReplacementCourse: '승인된 대체과정', otherLanguageFLEX: '기타언어 FLEX', courseCredits: '과목 학점 이수',
  courseCompletion: '과정 이수', basicLanguageCourseCompletion: '기초어학 과정 이수', courseCompletionCertificate: '과정 수료증',
  certificate: '자격 인증', externalCertificate: '외부 자격 인증', technicalCertificate: '기술 자격증',
  course: '과목 이수', coursePassed: '과목 통과', designatedCourses: '지정 과목 이수', requiredMajorCourses: '전공필수 이수',
  majorCredits: '전공 학점', majorGPA: '전공 평점', GPAWaiver: '평점에 따른 면제', registeredSemesters: '등록 학기',
  graduationExam: '졸업시험', graduationThesis: '졸업논문', graduationProject: '졸업프로젝트', graduationProjectPassed: '졸업프로젝트 통과',
  thesis: '논문', thesisPassed: '논문 통과', thesisPresentation: '논문 발표', thesisAssessment: '논문 평가',
  thesisSubmissionAndReview: '논문 제출 및 심사', thesisSubmissionAndPass: '논문 제출 및 통과', thesisPlanAndSubmission: '논문 계획서 및 논문 제출',
  essaySubmissionAndReview: '에세이 제출 및 심사', temporaryThesisAlternative: '한시적 논문 대체',
  approvedPortfolioAlternative: '승인된 포트폴리오 대체', portfolioReview: '포트폴리오 심사',
  capstoneThesisPassed: '캡스톤 논문 통과', firstAuthorAcademicPaperSubmitted: '학회 논문 제1저자 제출',
  externalCompetitionAward: '교외 대회 수상', academicConferenceOrJournalPaper: '학회 또는 학술지 논문',
  capstoneCourseAndThesisSubmitted: '캡스톤 과목 이수 및 논문 제출', facultyCollaborativePaper: '교수 공동 연구 논문',
  programChairApproval: '전공 책임자 승인', departmentChairApprovedReplacement: '학과장 승인 대체',
  unavoidableReasonRecognized: '불가피한 사유 인정', conditionalAssessmentWaiver: '조건부 졸업평가 면제',
  approvedAssessmentAlternative: '승인된 졸업평가 대체', approvedLanguageAssessmentAlternative: '승인된 어학 대체 경로',
  approvedLanguageAssessmentReplacement: '승인된 어학성적 대체', approvedCertificateReplacement: '승인된 인증서 대체',
  departmentAssessmentWaiver: '졸업평가 면제', approvedDepartmentExamWaiver: '승인된 졸업시험 면제',
  lawSchoolFinalAdmission: '법학전문대학원 최종 합격', undergraduateResearch: '학부 연구 이수',
  languageTrack: '어학 경로', regionalResearchProjectPassed: '지역 연구 프로젝트 통과', regionalResearchProject: '지역 연구 프로젝트',
  statefulDepartmentAssessment: '단계별 학과 졸업평가', oralExam: '구술시험', languageIntensiveRequirement: '집중어학 요건',
  FLEXFourSectionWaiver: 'FLEX 4영역 면제', graduationQualification: '졸업 자격',
  nationalDiplomaticAcademyFirstExamAttempted: '국립외교원 1차시험 응시', civilExamAttempted: '공무원시험 응시',
  englishCertification: '영어 인증', secondForeignCertification: '제2외국어 인증', civilExamFirstStagePassed: '공무원시험 1차 합격',
  creativeWorkPassed: '창작물 심사 통과', civilExamQualification: '국가시험 합격', specificCompetitionAward: '지정 대회 수상',
  JLPTLevel: 'JLPT', languageExamSet: '어학시험', oralOrPracticeOrAudiovisualExam: '구술·실습·시청각 시험',
  regionalElectives: '지역 선택과목', adjustableDepartmentExamThreshold: '학과 졸업시험 (합격선 조정 가능)',
  nationalExam: '국가시험', award: '수상', weightedDepartmentAssessment: '가중치 적용 졸업평가',
  threeSelectedDepartmentExams: '선택한 학과시험 3과목', sumScore: '합산 점수',
  alternativeAssessments: '졸업평가 선택 경로', projectAssessment: '프로젝트 평가', conditionalExamPassScore: '조건별 시험 합격 점수',
  employmentConfirmed: '취업 확인', laboratoryActivity: '연구실 활동', languageExamSubstitution: '어학시험 대체',
  meanNormalizedSectionPercent: '영역별 환산 백분율 평균', FLEXArea: 'FLEX 영역',
  TORFL: 'TORFL', 'FLEX Czech listeningReading': 'FLEX 체코어 듣기·읽기', testGrade: '시험 등급',
  FLEXRussian: 'FLEX 러시아어', FLEXRussianAttempted: 'FLEX 러시아어 응시', FLEXMongolian: 'FLEX 몽골어',
  FLEXSpanish: 'FLEX 스페인어', FLEXEnglish: 'FLEX 영어', FLEXSpanishSpeaking: 'FLEX 스페인어 말하기',
  FLEXSpanishWriting: 'FLEX 스페인어 쓰기', FLEXSpanishListeningReading: 'FLEX 스페인어 듣기·읽기',
};

const LABELS: Record<string, string> = {
  threshold: '기준', minimumScore: '최저 점수', minimumPassingScore: '합격 점수', minimumLevel: '최저 등급', minimumGrade: '최저 등급',
  minimumHours: '최소 이수 시간', minimumTrainingHours: '최소 연수 시간', minimumCredits: '최소 학점', minimumMeanGPA: '최소 평균 평점',
  minimumGradeLabel: '최저 성적', minimumLengthPages: '최소 분량(쪽)', minimumA4Pages: '최소 A4 분량(쪽)',
  minimumPaperCount: '최소 논문 수', minimumCurrentSemester: '최소 재학 학기', minimumRegisteredSemesters: '최소 등록 학기',
  minimumCompletedSemesters: '최소 이수 학기', minimumRegisteredSemestersForAllRoutes: '모든 경로의 최소 등록 학기',
  minimumEachScore: '과목별 최저 점수', minimumEachNonwaivedScore: '비면제 과목별 최저 점수', minimumMeanScore: '최저 평균 점수',
  minimumEachSubjectScore: '과목별 최저 점수', minimumAverageScore: '최저 평균 점수', minimumTotal: '최저 합계',
  minimumFLEXAttempts: '최소 FLEX 응시 횟수', minimumAttempts: '최소 응시 횟수', minimumActivityMonths: '최소 활동 개월',
  maximumAgeMonths: '성적 최대 경과 개월', maximumAgeYears: '성적 최대 경과 연수', maximumScoreAgeMonths: '성적 최대 경과 개월',
  maximumFLEXAgeYears: 'FLEX 성적 최대 경과 연수', scoreValidityYears: '성적 유효 연수', validityYears: '유효 연수', validYears: '유효 연수',
  durationMinutes: '시험시간(분)', approximateDurationMinutes: '예상 시험시간(분)', questionCount: '문항 수',
  presentationMinutes: '발표 시간(분)', questionAndAnswerMinutes: '질의응답 시간(분)', minimumPercent: '최소 백분율',
  maximumScore: '만점', maximumTotalScore: '총점', sectionFailCutoff: '영역별 과락', normalMinimumScore: '일반 합격 점수',
  reducedMinimumScore: '감면 합격 점수', minimumJournalIndex: '최소 학술지 기준', minimumEarnedMajorCredits: '최소 취득 전공학점',
  minimumMeanGPAForFourFoundationCourses: '기초 4과목 최소 평균 평점',
  count: '개수', choose: '선택 개수', selectCount: '선택 개수', subjectCount: '시험 과목 수', selectedCourseCount: '선택 과목 수',
  minimum: '하한', maximum: '상한', min: '하한', max: '상한', maximumInclusive: '이하',
  subjects: '시험 과목', requiredSubjects: '필수 과목', electiveSubjects: '선택 과목', selectFrom: '선택 과목', subjectChoice: '선택 과목',
  subjectPool: '선택 과목 목록', electiveSubjectCount: '선택 과목 수', subjectSelection: '과목 선택', subjectPrerequisite: '선수 과목',
  components: '평가 영역', sections: '시험 영역', course: '과목', courses: '과목', requiredCourses: '필수 과목', foundationCourseNames: '기초 과목',
  language: '언어', excludedLanguages: '제외 언어', allowedLanguage: '허용 언어', testAdministration: '시험 시행 기관', provider: '교육기관',
  approvedProviders: '인정 교육기관', acceptedNames: '인정 자격명', listedNames: '명시된 자격명', acceptedTests: '인정 시험',
  acceptedLevels: '인정 등급', acceptedGrades: '인정 성적', acceptedForms: '인정 형태', acceptableFormats: '인정 형식',
  credits: '학점', creditUnits: '학점(100배 단위)', minimumLength: '최소 분량', fontPoints: '글자 크기(pt)', lineSpacingPercent: '줄 간격(%)',
  maximumSimilarityPercentExclusive: '유사도 미만(%)', maximumPerField: '분야별 최대 과목 수', minimumPerField: '분야별 최소 과목 수',
  maximumAttempts: '최대 응시 횟수', validity: '유효기간', validUntil: '유효 기한', validityAtSubmission: '제출 시 유효기간',
  alreadyCertifiedValidityUntilGraduation: '인증 후 졸업 시까지 유효', scoreValidity: '성적 유효기간', validityMonths: '유효 개월',
  revocation: '무효 조건', revokedOnExpulsion: '제적 시 무효', invalidatedOnLossOfStudentStatus: '학적 상실 시 무효',
  effectiveFrom: '시행 시점', effectiveFromTerm: '시행 학기', effectiveFromGraduationTerm: '시행 졸업 학기',
  measuredAt: '산정 시점', measuredAfter: '산정 시점', laterRoutesFrom: '추가 경로 시행 학기', graduationPeriod: '적용 졸업월 범위',
  condition: '적용 조건', conditions: '적용 조건', eligibility: '응시 자격', eligibilityDetails: '대상 조건',
  exception: '예외', exceptions: '예외', exemptions: '면제 조건', exceptIfComposition: '제외 전공 구성', appliesTo: '적용 대상',
  scope: '적용 범위', scopeNote: '적용 안내', scopeLimit: '확인된 적용 범위', appliesAlsoTo: '추가 적용 대상',
  documentRule: '서류 제출 기준', documentRuleScope: '서류 기준 적용 범위', requiredForms: '제출 서식', requiredEvidence: '필요 증빙',
  submission: '제출', submissionOffice: '제출처', submissionWindow: '제출 기간', submitTo: '제출처', recipient: '제출처',
  procedure: '절차', process: '절차', administration: '시행 안내', schedule: '일정', sessions: '교시', tracks: '대상별 일정',
  announcement: '공고', note: '안내', details: '세부 안내', unknownReason: '확인 필요', detailsUnknownReason: '확인 필요',
  provisionalNote: '변경 가능 안내', reductionCondition: '감면 조건', failConsequence: '불합격 시 처리',
  passRule: '통과 기준', perSubjectMin: '과목별 최저 점수', averageMin: '최저 평균 점수', flexThreshold: 'FLEX 최저 점수',
  languageCertificationRequired: '어학 인증 필요', oralExamRequired: '구술시험 필요', thesisRequired: '논문 필요', required: '요건 필요',
  otherGraduationRequirementsStillRequired: '다른 졸업요건도 충족 필요', schoolCommonCertificationIsSeparate: '학교 공통 인증은 별도',
  schoolLanguageCertificationNotAutomaticallyWaived: '학교 어학인증 자동 면제 안 됨',
  departmentRecognitionRequired: '학과 인정 필요', departmentApprovalRequired: '학과 승인 필요', approvalRequired: '승인 필요',
  approvalBeforeCourseRequired: '수강 전 승인 필요', priorDepartmentConsultationRequired: '사전 학과 상담 필요',
  advisorApprovalRequired: '지도교수 승인 필요', supervisorApprovalRequired: '지도교수 승인 필요', requiresProfessorApproval: '교수 승인 필요',
  equivalentRequiresChairApproval: '동등 자격은 학과장 승인 필요', otherCertificatesRequireChairApproval: '그 밖의 자격은 학과장 승인 필요',
  supervisorIssuedCompletionDocumentRequired: '지도교수 발급 이수 확인서 필요', supervisorSignatureRequired: '지도교수 서명 필요',
  mustReceivePass: 'Pass 필요', mustPass: '통과 필요', mustPassAll: '모두 통과 필요', mustPassBoth: '둘 다 통과 필요',
  applicationAndEvidenceRequired: '신청서와 증빙 모두 필요', applicationCheckboxAndEvidenceSubmissionBothRequired: '신청 체크와 증빙 제출 모두 필요',
  submissionFormAndConfirmationEmailBothRequired: '제출 서식과 확인 메일 모두 필요', evidenceRequired: '증빙 필요',
  completionCertificateRequired: '수료증 필요', originalScoreReportsRequired: '성적표 원본 수', plagiarismReportRequired: '표절검사 결과 필요',
  capstoneEnrollmentRequired: '캡스톤 수강 필수', substituteAlsoWaivesCapstoneEnrollment: '대체 시 캡스톤 수강도 면제',
  mustBeEnrolled: '재학 필요', currentlyEnrolled: '현재 재학 필요', studentsOnLeaveEligible: '휴학생 응시 가능',
  mustSelectAlreadyCompletedSubjects: '이수한 과목에서 선택', electivesMustAlreadyBeCompleted: '선택과목 사전 이수 필요',
  allRequiredCoursesMustHaveBeenCompleted: '전공필수 전부 이수 필요', requiredCoursesRequired: '전공필수 필요',
  doesNotWaiveCreditsRequiredOrBasicCourses: '학점·필수·기초과목은 면제하지 않음', doesNotWaiveCreditsOrRequiredCourses: '학점·전공필수는 면제하지 않음',
  doesNotAutomaticallyWaiveCommonLanguageCertification: '학교 공통 어학인증 자동 면제 안 됨', commonLanguageCertificationWaived: '학교 공통 어학인증 면제',
  doesNotWaiveDepartmentAssessment: '학과 졸업평가 면제 안 됨', doesNotReplaceDepartmentThesis: '학과 논문을 대체하지 않음',
  doesNotReplaceOtherLanguageCertification: '기타언어 인증을 대체하지 않음', doesNotReplaceDepartmentChineseAssessment: '학과 중국어 평가를 대체하지 않음',
  replacesDepartmentExam: '학과 졸업시험 대체', departmentExamRequired: '학과 졸업시험 필요', withoutCourseDepartmentExamRequired: '과목 미이수 시 학과 졸업시험 필요',
  allAttemptDatesAfterRegisteredSemesterSeven: '모든 응시는 7학기 등록 이후', acquiredAfterAdmission: '입학 후 취득', mustBeTakenAfterAdmission: '입학 후 응시',
  languageMustDifferFromDualAndMinorLanguages: '이중·부전공과 다른 언어 필요', mustSubmitEvidenceForCertification: '인증 증빙 제출 필요',
  nonwaivedZeroOrAbsentDisablesAllReports: '비면제 과목 0점·결시 시 모든 보고서 대체 불가', reportMustReceivePass: '보고서 Pass 필요',
  noWaiverMeanAtLeast60AndAllAtLeast40AlreadyPass: '면제 없음: 평균 60·각 40점 이상이면 합격',
  partialPassCarriedForward: '부분 합격 이월', approvedAGradeCourseWaiversRemain: '승인된 A학점 과목 면제 유지', reselectSubjectsAllowed: '재응시 과목 재선택 허용',
  approvedCourseWaiversCountInSelectedFour: '승인된 면제 과목도 선택한 4과목에 포함',
  automaticAnyAwardAcceptance: '모든 수상 자동 인정', eligibleCompetitionAndPlaceMustBeConfirmed: '인정 대회·수상 등위 확인 필요',
  eligibleCompetitionNames: '인정 대회', requiresPreviousExamFail: '이전 시험 불합격 필요', lowScoreNotQualifyingFail: '낮은 점수만으로 대체 자격 불인정',
  mustStillMeetMinorCredits: '부전공 학점은 별도 충족 필요', courseEnrollmentRestrictedToPrimary: '주전공만 수강 가능',
  hasPriorFLEXScoreDisallowsAlternative: '기존 FLEX 성적이 있으면 대체 불가', requiresVacationCourseImpossibleDueToEmployment: '취업으로 방학 수강 불가능한 경우만',
  conversionInternshipContractMayBeAccepted: '전환형 인턴 계약서 인정 가능', automaticCertification: '자동 인증',
  presentationRequired: '발표 필요', orientationRequired: '설명회 참여 필요', finalSubmissionRequired: '최종 제출 필요',
  proposalApprovalBeforeExecutionRequired: '실행 전 계획 승인 필요', assignmentMustBeCompleted: '과제 완료 필요',
  departmentReviewMustPass: '학과 심사 통과 필요', mustPassReviewOrExam: '심사 또는 시험 통과 필요',
  mustAlsoMeetSeparateGraduationQualification: '별도 졸업자격도 충족 필요', qualificationAndExamAndRequiredCoursesMustAllBeAddressed: '졸업자격·시험·전공필수 모두 필요',
  waiverSatisfiesQualificationAlso: '면제가 졸업자격도 충족', separateRequiredCoursesStillApply: '전공필수는 별도 적용',
  universityCommonRequirementsStillApply: '학교 공통요건은 별도 적용', employmentDoesNotWaive: '취업으로 면제 안 됨',
  passRemainsValidUntilGraduationUnlessAcademicStatusLost: '학적 상실 외에는 졸업까지 합격 유효',
  examPassRemainsValidUntilGraduationExceptLossOfAcademicStatus: '학적 상실 외에는 졸업까지 시험 합격 유효',
  passedSubjectNotCarriedOnOtherSubjectFail: '다른 과목 불합격 시 과목 합격 이월 안 됨', resitsUnlimited: '재응시 횟수 제한 없음',
  sameAreaTwoSubjectsForbidden: '같은 분야 2과목 선택 불가', scoreAboveThresholdInOtherSectionDoesNotCompensate: '다른 영역 점수로 과락 보완 불가',
  firstStagePassed: '1차 합격', finalPassed: '최종 합격', noCourseWaivers: '과목 면제 없음', someCourseWaivers: '일부 과목 면제',
  passBranches: '경우별 통과 기준', reportReplacement: '보고서 대체', otherwiseEligibleScoreBands: '그 밖의 보고서 허용 점수',
  resit: '재응시', courseGradeWaiver: '과목 성적에 따른 면제', selection: '과목 선택', fields: '분야',
  initialRoutes: '최초 경로', thesisAlternative: '논문 대체', normalRoute: '일반 경로', weekendRoute: '주말 경로',
  courseMinimumLevel: '과정 최저 등급', alsoRequired: '함께 필요', chooseOne: '하나 선택',
  primary: '주전공', dual: '이중전공', minor: '부전공', transferOrForeign: '편입·외국인 학생',
  minorApplicable: '부전공 적용', minorExcluded: '부전공 제외', waiver: '면제',
  oneAsLiberalArtsOneAsMajor: '한 과목 교양·한 과목 전공 인정', expectedGraduate: '졸업 예정자',
  applicationWithinDepartmentPeriod: '학과 접수 기간 내 신청 필요', individualAllowed: '개인 참여 허용',
  attachmentsFullyReviewed: '첨부자료 전체 확인', durationApproximate: '시험시간은 대략적인 값',
  mustBeWithinTestValidity: '시험 성적 유효기간 이내여야 함', minorCertificationAbolished: '부전공 인증 폐지',
  priorPassedStudentsNotAutomaticallySubjectToNewPresentation: '기존 합격자에게 새 발표 의무를 자동 적용하지 않음',
  unlimitedExplicitlyAllowed: '횟수 제한 없음 명시', FLEXRussianRequired: 'FLEX 러시아어 필요', otherTestsAccepted: '다른 시험 인정',
  teacherCertificationSeparateFromDegree: '교원자격은 학위와 별도', refundExclusionDoesNotMeanScoreRejected: '응시료 환급 제외와 성적 불인정은 별개',
  fieldTripsRequired: '현장답사 필요', attemptsUnlimited: '응시 횟수 제한 없음',
  CNaVTExamplesNotAutomaticallyGraduationAlternatives: 'CNaVT 예시를 졸업 대체로 자동 인정하지 않음',
  exactFailDefinitionNeedsReview: '대체 가능한 불합격의 정의 확인 필요', assessmentChoiceIsExamOrThesis: '시험 또는 논문 선택',
  analysisAndLinearAlgebraBothSemestersRequired: '해석학·선형대수학 양 학기 모두 필요', finalPracticalScoreEvidenceRequired: '실기 최종 성적 증빙 필요',
  industrialEngineerCertificateAccepted: '산업기사 자격 인정', thesisOrPresentationMayBeRequired: '논문 또는 발표가 필요할 수 있음',
  majorGPAMustIncludeAllCompletedSemestersAtSubmission: '제출 시 이수한 모든 학기의 전공 평점 포함',
  allZeroRestrictsNextTermAttempt: '모든 과목 0점이면 다음 학기 응시 제한', oralReplacementRequiresFacultySelection: '구술 대체는 교수 선발 필요',
  previous2015MinorFLEX450SupersededOnlyFrom2021: '2015 부전공 FLEX450 기준은 2021부터만 변경',
  proposalAndPresentationRequired: '계획서와 발표 필요', mustNotHaveBeenSubmittedForOtherCourse: '다른 과목에 제출한 작품 불가',
  AIWrittenWorkDisallowed: 'AI 작성 작품 불가', mustRemainValid: '유효기간 유지 필요',
  teacherCertificateRequiresTOPIK6Separately: '교원자격은 TOPIK6 별도 필요', onceMetDuringEnrollmentRemainsQualified: '재학 중 충족 후 자격 유지',
  englishAndSecondForeignNotNeededOnDiplomaticAcademyAttemptRoute: '국립외교원 응시 경로는 영어·제2외국어 불필요',
  retroactiveApplicationMayOccurNotAutomatic: '소급 적용 가능 여부는 별도 확인', whenMeanBelow60OnlyIndividualAtLeast60Pass: '평균 60 미만이면 개별 60 이상 과목만 합격',
  procedureNeedsReview: '절차 확인 필요', appliesToForeignTransferChangedMajor: '외국인·편입·전과 학생 적용',
  scoreExpires: '성적 유효기간 만료 적용', dualAndMinorThresholdsNotPubliclySpecified: '이중·부전공 점수 기준은 공개자료 확인 필요',
  documentationRequired: '서류 제출 필요', foreignOrOverseasOrGiftAdmissionNotExempt: '외국인·재외국민·특기자 전형도 면제하지 않음',
  IBTAndHSKRefundExcludedButGraduationAccepted: 'iBT·HSK는 환급 제외지만 졸업요건 인정',
  previousHigherRetakeScorePreserved: '재응시 전 높은 성적 보존', unexcusedAbsenceRestrictsSameSubjectNextTerm: '무단결시 시 다음 학기 동일 과목 응시 제한',
  registeredAndCompletedSevenTermsLeaveOfAbsenceMayApply: '7학기 등록·이수한 휴학생 신청 가능', expiredTwoYearsStillAccepted: '2년 경과 성적도 인정',
  lowerScoreAlternativeRequiresDepartmentMeetingApproval: '낮은 점수 대체는 학과회의 승인 필요', expiredAfterAdmissionScoreAllowed: '입학 후 취득한 만료 성적 인정',
  teacherCertificationAndOtherDepartmentExamRemainSeparate: '교원자격·다른 학과 시험은 별도', minorCreditMinimumOnly: '부전공 최소학점만 필요',
  acceptedVenueRequiresDepartmentRegulation: '학술대회·학술지 인정은 학과 규정 확인 필요', mustCompleteThirdYear: '3학년 이수 필요',
  timeIsProvisional: '일정은 잠정 안내', universityLanguageCenterInternalTestAccepted: '대학 어학원 자체시험 인정',
  failedHigherLevelDoesNotAutomaticallyGrantLowerLevel: '상위 등급 불합격으로 하위 등급 자동 인정 안 됨', supervisorAgreementRequired: '지도교수 동의 필요',
  ruleIsInPrinciple: '원칙 기준', explicitNoRequirement: '요건 없음 명시', calculator: '계산기 허용', planDocument: '계획서 필요',
  duringGraduationSemester: '졸업 학기에 이행', validAtDepartmentSubmission: '학과 제출 시 유효해야 함', alternativeTestsAccepted: '대체 시험 인정',
  departmentEnglishScoreSubmissionAlsoProcessesSchoolEnglishCertification: '학과 영어성적 제출로 학교 영어인증 동시 처리',
  additionalSchoolCenterSubmissionRequired: '학교 센터에 추가 제출 필요', initialAttemptAfterEightSemestersUsesNormalScore: '8학기 후 최초 응시는 일반 점수 적용',
  currentYearAloneDoesNotQualify: '현재 학년만으로 감면 자격 충족 안 됨', schoolDefaultOnly: '학교 공통 기본 기준만 확인',
  departmentMayImpose: '학과가 별도 부과 가능', onlyFLEXAccepted: 'FLEX만 인정',
  chooseSubjectCount: '선택 과목 수', minimumCareerConsultations: '최소 진로상담 횟수',
  minimumConsultationRequestsPerSemester: '학기별 최소 상담 신청 횟수', teamMinimumMembers: '최소 팀원 수',
  approximatePaperPages: '논문 예상 쪽수', approximateVideoMinutes: '영상 예상 길이(분)', minimumRemainingMonths: '최소 남은 유효 개월',
  departmentExam: '학과 졸업시험', qualificationRoutes: '졸업자격 경로', examAlternatives: '시험 대체 경로',
};

const WORDS: Record<string, string> = {
  graduation: '졸업 시까지', transfer: '편입', readmitted: '재입학',
  german2023Revision: '2023년 개정 평가 기준',
  generalTransfer: '일반편입', bachelorTransfer: '학사편입', transferGeneral: '일반편입', transferBachelor: '학사편입', freshman: '신입학',
  submissionDate: '제출일 기준', numeric: '점수', OPIcOrderedLevel: 'OPIc 등급',
  Chinese: '중국어', Japanese: '일본어', French: '프랑스어', Spanish: '스페인어', German: '독일어', Russian: '러시아어', Arabic: '아랍어',
  English: '영어', english: '영어', nonEnglish: '영어 이외 언어', primary: '주전공', dual: '이중전공', minor: '부전공',
  departmentGraduationExam: '학과 졸업시험', departmentAssessment: '학과 졸업평가', commonLanguageCertification: '학교 외국어 인증',
  'FLEX listeningReading': 'FLEX 듣기·읽기', 'FLEX Czech listeningReading': 'FLEX 체코어 듣기·읽기',
  TOEFL_IBT: 'TOEFL iBT', TOEFL_CBT: 'TOEFL CBT', intensiveSingle: '전공심화', intensiveWithMinor: '전공심화·부전공',
  listeningReading: '듣기·읽기', listening: '듣기', reading: '읽기', speaking: '말하기', writing: '쓰기',
  FLEXListeningReading: 'FLEX 듣기·읽기', thirdYearSecondSemester: '3학년 2학기',
  otherLanguageMajorBasicCourses: '기타언어 전공 기초과목', dualMajorLanguage: '이중전공 언어', minorLanguage: '부전공 언어',
  singleExempt: '단일전공', dualMajor: '이중전공', 'KCI candidate': 'KCI 후보',
};
const OMIT = new Set(['type', 'op', 'sourceRefs', 'sourceIds', 'coversRuleIds', 'linkedRuleIds', 'introducedBy', 'currentDivisionRuleIds',
  'listCompleteness', 'codeUnknownReason', 'sourcePublishedIdentifiers', 'derivation', 'validityConversion', 'conversion', 'scoreScaleMapping', 'scoreScale', 'isAlternativeOption', 'addsOptionTo']);
// 조합된 시험명도 학생용 한글 표현으로 통일한다. 원본 데이터·점수는 바꾸지 않는다.
const clean = (v: string): string => {
  const text = WORDS[v] ?? TYPES[v] ?? v
    .replace(/\bFLEX\s+(English|Japanese|German|French|Spanish|Russian|Chinese|Arabic)\b/g,
      (_, language: string) => `FLEX ${WORDS[language]}`)
    .replace(/\blisteningReading\b/g, '듣기·읽기')
    .replace(/\bTOEFL iBT new scale\b/gi, 'TOEFL iBT (개정 점수 체계)');
  return (/[a-z][A-Z]|_/.test(text) && !/[가-힣]/.test(text) ? '확인 필요' : text)
    .replace(/\b(?:unknown|null|undefined)\b|아직 모름/g, '확인 필요');
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const unique = (parts: string[]) => [...new Set(parts.filter(Boolean))].join(' · ');

export function describeAssessment(value: unknown): string {
  if (value === null || value === undefined) return '확인 필요';
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '필요' : '해당하지 않음';
  if (Array.isArray(value)) return value.map(describeAssessment).join(' / ');
  const d = obj(value);
  if (d.type === 'commonLanguageCertification' && d.language === 'English' && obj(d.expression).op === 'OR' && Array.isArray(obj(d.expression).items)) {
    const options = obj(d.expression).items as unknown[];
    const notes = new Set<string>();
    const paths = options.map((option) => {
      const item = obj(option);
      const { testAdministration, administrationUnknownReason, validity, ...criterion } = item;
      if (typeof testAdministration === 'string') notes.add(`FLEX 인정 범위: ${testAdministration}.`);
      if (typeof administrationUnknownReason === 'string') notes.add(`${administrationUnknownReason}.`);
      if (validity != null) notes.add(`성적 유효기간: ${describeAssessment(validity)}.`);
      return describeAssessment(criterion).replace(/ · 기준: /g, ' ').replace(/ · 최소 연수 시간: /g, ' ');
    });
    const { type, language, expression, validityAtSubmission, ...remaining } = d;
    return [`다음 중 하나를 충족해 주세요: ${paths.join('; ')}.`, ...notes,
      validityAtSubmission === true ? '제출일에 유효한 성적이어야 해요.' : '',
      Object.keys(remaining).some((key) => remaining[key] != null) ? describeAssessment(remaining) : ''].filter(Boolean).join(' ');
  }
  if (typeof d.field === 'string') {
    const label = ({ entryType: '입학 유형', registeredSemesters: '등록 학기', isGraduationExamRetake: '졸업시험 재응시' } as Record<string, string>)[d.field] ?? ASKABLE_FIELDS[d.field]?.label;
    if (!label) return '적용 조건 확인 필요';
    if (d.op === 'in' && Array.isArray(d.values)) return `${label}: ${d.values.map(describeAssessment).join(' 또는 ')}`;
    if (d.op === 'eq') return `${label}: ${typeof d.value === 'boolean' ? d.value ? '예' : '아니요' : describeAssessment(d.value)}`;
    if (d.op === 'range') return unique([label, d.min != null ? `${describeAssessment(d.min)} 이상` : '', d.max != null ? `${describeAssessment(d.max)} 이하` : '']);
    return `${label}: 조건 확인 필요`;
  }
  if (Array.isArray(d.conditions)) return `${d.op === 'OR' ? '하나 해당' : '모두 해당'}: ${d.conditions.map(describeAssessment).join(d.op === 'OR' ? ' 또는 ' : ', ')}`;
  if ('value' in d) return d.value == null ? `확인 필요${d.unknownReason ? ` (${describeAssessment(d.unknownReason)})` : ''}` : describeAssessment(d.value);
  if (Array.isArray(d.items)) {
    if (d.op === 'OR' && d.items.length === 2 && d.items.every((i) => ['departmentExamPassed', 'departmentThesisPassed'].includes(String(obj(i).type)))) {
      return '학과 졸업시험 또는 졸업논문 통과';
    }
    const join = d.op === 'OR' ? ' / ' : ' + ';
    const label = d.op === 'OR' ? '하나 선택' : d.op === 'AT_LEAST' ? `${describeAssessment(d.count)}개 이상` : '모두 필요';
    const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !['type', 'op', 'items', 'count'].includes(k)));
    // 동일한 기관·유효기간 안내는 해당 선택지들의 이름을 붙여 한 번만 표시한다.
    const items = d.items.map((item) => ({ ...obj(item) }));
    const shared: string[] = [];
    for (const key of ['testAdministration', 'administrationUnknownReason', 'validity']) {
      const groups = new Map<string, number[]>();
      items.forEach((item, i) => { if (item[key] != null) { const k = JSON.stringify(item[key]); groups.set(k, [...(groups.get(k) ?? []), i]); } });
      for (const indices of groups.values()) if (indices.length > 1) {
        const sample = items[indices[0]];
        shared.push(`${indices.map((i) => describeAssessment(items[i].testName ?? items[i].test ?? items[i].type)).join('·')}: ${describeAssessment({ [key]: sample[key] })}`);
        indices.forEach((i) => { delete items[i][key]; });
      }
    }
    return unique([`${label} [${d.items.map((item, i) => describeAssessment(typeof item === 'object' && item !== null ? items[i] : item)).join(join)}]`, ...shared, Object.keys(rest).length ? describeAssessment(rest) : '']);
  }
  const explicit = d.testName ?? d.test ?? d.name ?? d.courseName ?? d.examName ?? d.exam;
  const name = explicit != null ? describeAssessment(explicit) : TYPES[String(d.type)] ?? '';
  const parts = d.normalMinimumScore != null ? [] : [name];
  if (d.normalMinimumScore != null) parts.push(`${name} ${describeAssessment(d.normalMinimumScore)}점 이상`);
  const isThreshold = (k: string) => /^minimum|^maximum|Threshold$|Score$|Grade$|Level$/.test(k) || k === 'threshold';
  for (const [key, v] of Object.entries(d)) {
    if (OMIT.has(key) || ['testName', 'test', 'name', 'courseName', 'examName', 'exam', 'operator', 'passingOperator'].includes(key) || v == null) continue;
    const rendered = describeAssessment(v);
    if (!rendered) continue;
    const label = LABELS[key] ?? (/^[가-힣\d·\s]+$/.test(key) ? key : WORDS[key]);
    let suffix = '';
    const scalar = 'value' in obj(v) ? obj(v).value : v;
    if (key === 'normalMinimumScore') continue;
    if ((key === 'minimumEachScore' || key === 'minimumMeanScore') && scalar != null) {
      parts.push(`${key === 'minimumEachScore' ? '과목별' : '평균'} ${rendered}점 이상`); continue;
    }
    if (['subjects', 'requiredSubjects', 'electiveSubjects', 'subjectChoice', 'selectFrom'].includes(key) && Array.isArray(v)) {
      parts.push(`${label}: ${v.map(describeAssessment).join(', ')}`); continue;
    }
    if (isThreshold(key) && scalar != null && (typeof scalar === 'number' || typeof scalar === 'string')) {
      suffix = /Score|threshold|flexThreshold/.test(key) ? '점' : /Hours/.test(key) ? '시간' : /Credits/.test(key) ? '학점' : '';
      if (key === 'threshold') suffix = d.scoreScale === 'numeric' ? '점' : d.scoreScale === 'OPIcOrderedLevel' ? '등급' : '';
      const comparison = typeof d.operator === 'string' ? d.operator : typeof d.passingOperator === 'string' ? d.passingOperator : /maximum/.test(key) ? '≤' : '≥';
      const word = ({ '>=': '이상', '≥': '이상', '<=': '이하', '≤': '이하', '>': '초과', '<': '미만', '=': '', '==': '' } as Record<string, string>)[comparison];
      parts.push(word === undefined ? `${label ?? '기준'}: 비교 조건 확인 필요 · ${rendered}${suffix}`
        : `${label ?? '기준'}: ${rendered}${suffix} ${word}${comparison === '>' || comparison === '<' ? ` (${comparison} ${rendered})` : ''}`.trim());
    } else if (label) parts.push(`${label}: ${rendered}`);
    else if (typeof v === 'boolean') parts.push('확인 필요');
    else parts.push(rendered);
  }
  return unique(parts) || '확인 필요';
}

/** 카드의 작은 글씨에는 이행 기준만 남긴다. 원본 데이터와 공식 판정은 변경하지 않는다. */
export function briefAssessment(value: unknown): string {
  const explanation = new Set(['unknownReason', 'detailsUnknownReason', 'administrationUnknownReason',
    'testAdministration', 'appliesTo', 'scope', 'scopeNote', 'scopeLimit', 'note', 'details', 'basis',
    'validUntil', 'revokedOnExpulsion', 'invalidatedOnLossOfStudentStatus', 'minorApplies', 'minorApplicable',
    'listCompleteness', 'difficulty', 'questionCount', 'durationMinutes']);
  const project = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(project).filter((v) => v != null);
    if (value == null || typeof value !== 'object') return value;
    const d = obj(value);
    if ('value' in d && !('op' in d)) return d.value == null ? '기준 확인 필요' : d.value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(d)) {
      if (v == null || explanation.has(key) || OMIT.has(key) && !['type', 'op', 'scoreScale'].includes(key)) continue;
      if (key === 'type' && ['commonLanguageCertification', 'departmentLanguageRequirement', 'assessmentRequired'].includes(String(v))) continue;
      if (key === 'language') continue;
      if (key === 'minimumScores' && typeof v === 'object') {
        out.expression = { op: 'OR', items: Object.entries(obj(v)).map(([test, score]) => ({ test: WORDS[test] ?? test,
          minimumScore: typeof score === 'string' && /개정|불명확/.test(score) ? `${score} (기준 확인 필요)` : score })) };
      } else {
        const projected = project(v);
        if (projected != null && (typeof projected !== 'object' || Object.keys(projected).length)) out[key] = projected;
      }
    }
    return Object.keys(out).length ? out : null;
  };
  const projected = project(value);
  if (projected == null) return '';
  return describeAssessment(projected)
    .replace(/제출 시 유효기간: 필요/g, '제출일에 유효한 성적 필요')
    .replace(/ · 기준: /g, ' ')
    .replace(/최소 연수 시간: /g, '')
    .replace(/ · (?:확인 필요)(?= · |$)/g, '');
}

export function assessmentRole(r: OfficialRule): 'obligation' | 'alternative' | 'information' {
  const d = obj(r.detail);
  if (r.none || d.explicitNoRequirement === true || d.required === false || d.thesisRequired === false
    || ['explicitRequirementRemoval', 'termSpecificExamAdministration', 'departmentExamApplication', 'certificationAdministrativeEquivalence',
      'commonLanguageCertificationOption'].includes(r.type)) return 'information';
  if (r.type === 'departmentExamPolicy' && !d.selection && !d.passRule && !d.minimumScore) return 'information';
  if (r.type === 'departmentLanguageRequirement' && !d.expression && typeof d.primary === 'string' && typeof d.dual === 'string') return 'information';
  if (/Alternative|Replacement|Waiver/.test(r.type) || d.replacesDepartmentExam === true) return 'alternative';
  return 'obligation';
}

export interface AssessmentGroup { eval: RuleEval; alternatives: RuleEval[]; information: RuleEval[] }

/** 안내에는 시험·점수·선택 경로만 남기고 접수 절차와 조사 메모는 공식 안내에서 확인한다. */
function assessmentGuideText(value: unknown, role: string): string {
  const keys = new Set(['type', 'test', 'testName', 'name', 'exam', 'examName', 'op', 'items', 'expression',
    'normalMinimumScore', 'reducedMinimumScore', 'minimumScore', 'minimumScores', 'minimumLevel', 'minimumGrade',
    'minimumMeanScore', 'minimumEachScore', 'minimumCredits', 'minimumHours', 'threshold', 'value', 'scoreScale', 'operator', 'passingOperator',
    'reductionCondition', 'conditions', 'field', 'min', 'max', 'values', 'explicitNoRequirement', role]);
  const project = (v: unknown): unknown => Array.isArray(v) ? v.map(project)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => keys.has(k)).map(([k, x]) => [k, k === 'minimumScores' ? x : project(x)])) : v;
  const d = obj(value);
  if (d.explicitNoRequirement === true || d.required === false) return '학과 졸업시험·인증 의무 없음';
  if (d.thesisRequired === false) return '학과 졸업논문 의무 없음';
  if (d.languageCertificationRequired === false && d.oralExamRequired === false) return '학과 어학인증·구술시험 의무 없음';
  const text = briefAssessment(project(value)).replace(/이상 이상/g, '이상');
  if (text.length <= 300 && text && !text.includes('확인 필요') && !(JSON.stringify(value) ?? '').includes('graduationPeriod')) {
    return text + (d.initialAttemptAfterEightSemestersUsesNormalScore === true ? ' · 8학기 후 최초 응시는 일반 점수 적용' : '');
  }
  const names = (v: unknown): string[] => {
    const x = obj(v);
    const children = obj(x.expression).items ?? x.items;
    if (Array.isArray(children)) return children.flatMap(names);
    const name = x.testName ?? x.test ?? x.name ?? x.exam ?? TYPES[String(x.type)] ?? '학과 졸업평가';
    return [typeof name === 'string' ? clean(name) : '학과 졸업평가'];
  };
  return `${[...new Set(names(value))].join(' / ')} 기준이 있어요. 세부 점수·적용 조건은 학과 안내를 확인해 주세요.`;
}

/** 명시적 대체 관계와 같은 문맥만 연결한다. 언어 인증·자격·제출 의무를 무조건 하나로 합치지 않는다. */
export function groupAssessments(report: Pick<OfficialReport, 'items' | 'evals'>): AssessmentGroup[] {
  // 면제 승인 답이 없다는 이유로 본래 이행 경로를 숨기지 않는다. 공식 판정은 needsInput 그대로 둔다.
  const pendingApproval = report.evals.filter((e) => e.cls === 'needsInput' && e.rule.status === 'verified'
    && e.askFields.length > 0 && e.askFields.every((f) => f.startsWith('approved')));
  const candidates = [...new Map([...report.items, ...pendingApproval].filter((e) => !e.rule.courses
    && ['departmentAssessment', 'commonLanguageCertification'].includes(e.rule.category)).map((e) => [e.rule.id, e])).values()];
  const covered = new Set(candidates.flatMap((e) => Array.isArray(obj(e.rule.detail).coversRuleIds) ? obj(e.rule.detail).coversRuleIds as string[] : []));
  const items = candidates.filter((e) => !covered.has(e.rule.id) && !e.rule.none && e.rule.type !== 'commonLanguageCertificationOption');
  const same = (a: RuleEval, b: RuleEval) => a.rule.departmentId === b.rule.departmentId && a.role === b.role && a.scope === b.scope && a.rule.category === b.rule.category;
  const references = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(references)
    : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => k === 'linkedRuleIds' && Array.isArray(x) ? x as string[] : references(x)) : [];
  const linked = new Set(items.flatMap((e) => references(e.rule.detail)));
  const specificOther = items.find((e) => e.rule.departmentId && e.rule.category === 'commonLanguageCertification' && obj(e.rule.detail).language === 'nonEnglish');
  const groups: AssessmentGroup[] = items.filter((e) => assessmentRole(e.rule) === 'obligation' && !linked.has(e.rule.id)
    && !(specificOther && !e.rule.departmentId && obj(e.rule.detail).language === 'nonEnglish'))
    .map((e) => ({ eval: e, alternatives: [], information: [] }));
  const subjects = (e: RuleEval) => {
    const d = obj(e.rule.detail);
    const values = d.subjectChoice ?? d.selectFrom ?? d.subjects;
    return Array.isArray(values) && values.every((v) => typeof v === 'string') ? JSON.stringify([...values].sort()) : null;
  };
  const hasPassScore = (e: RuleEval) => /"(?:minimumEachScore|minimumScore|minimumMeanScore|passScore)"/.test(JSON.stringify(e.rule.detail));
  for (const g of [...groups]) {
    if (g.eval.rule.type !== 'departmentExam' || hasPassScore(g.eval) || !subjects(g.eval)) continue;
    const parent = groups.find((p) => p !== g && same(p.eval, g.eval) && p.eval.rule.type === 'departmentExam'
      && hasPassScore(p.eval) && subjects(p.eval) === subjects(g.eval));
    if (parent) { parent.information.push(g.eval); groups.splice(groups.indexOf(g), 1); }
  }
  for (const e of items.filter((e) => assessmentRole(e.rule) === 'alternative')) {
    const d = obj(e.rule.detail);
    const language = /Language|Certificate/.test(e.rule.type);
    const possible = groups.filter((g) => same(g.eval, e) && (language
      ? /Language|language|FLEX/.test(g.eval.rule.type) || !!obj(g.eval.rule.detail).language || ['departmentAssessment', 'adjustableDepartmentExamThreshold'].includes(g.eval.rule.type)
      : /Exam|Assessment/.test(g.eval.rule.type) && !['graduationQualification', 'departmentLanguageRequirement'].includes(g.eval.rule.type)));
    const explicit = groups.find((g) => same(g.eval, e) && JSON.stringify(g.eval.rule.detail).includes(`"${e.rule.id}"`));
    const parent = explicit ?? (possible.length === 1 ? possible[0] : possible.find((g) => g.eval.rule.type === 'alternativeAssessments'));
    if (parent) parent.alternatives.push(e);
    else if (d.isAlternativeOption !== true) groups.push({ eval: e, alternatives: [], information: [] });
  }
  for (const e of items.filter((e) => assessmentRole(e.rule) === 'information')) {
    const parent = groups.find((g) => same(g.eval, e));
    if (parent) parent.information.push(e);
  }
  for (const e of items.filter((e) => linked.has(e.rule.id) && assessmentRole(e.rule) === 'obligation')) {
    const parent = groups.find((g) => same(g.eval, e) && references(g.eval.rule.detail).includes(e.rule.id));
    if (parent) parent.information.push(e);
  }
  for (const e of report.evals.filter((e) => e.rule.type === 'commonLanguageCertificationOption' && e.rule.status === 'verified'
    && e.askFields.every((f) => f === 'certificationLanguage' || f.startsWith('approved')))) {
    const target = obj(e.rule.detail).addsOptionTo;
    const parent = groups.find((g) => g.eval.rule.id === target);
    if (parent && !parent.alternatives.some((a) => a.rule.id === e.rule.id)) parent.alternatives.push(e);
  }
  return groups;
}

/** 안내에서만 전형·면제 답변을 제외한다. 공식 판정과 저장된 학생 답은 바꾸지 않는다. */
export function departmentAssessmentGuides(profile: StudentProfile, rules: OfficialRule[], dept: (id: string) => DepartmentFacts | undefined) {
  const omit = (c: Cond): Cond | null => {
    if (c.op === 'AND' || c.op === 'OR') {
      const conditions = c.conditions.map(omit).filter((x): x is Cond => x !== null);
      return conditions.length ? { ...c, conditions } : null;
    }
    if (c.op === 'NOT') { const condition = omit(c.condition); return condition ? { ...c, condition } : null; }
    if ('field' in c && (/Admission$/.test(c.field) || c.field.startsWith('approved'))) return null;
    return c;
  };
  const evals = evaluateRules(profile, rules.filter((r) => r.category === 'departmentAssessment')
    .map((r) => ({ ...r, condition: r.condition ? omit(r.condition) ?? { op: 'true' as const } : null })), dept)
    .filter((e) => e.rule.departmentId);
  const items = evals.filter((e) => e.rule.status === 'verified').map((e) => ({ ...e,
    rule: { ...e.rule, detail: e.facts.graduationMonthIndex === undefined ? e.rule.detail
      : detailForGraduation(e.rule.detail, e.facts.graduationMonthIndex) },
  }));
  const groups = groupAssessments({ items, evals: items });
  const used = new Set(groups.flatMap((g) => [g.eval, ...g.alternatives, ...g.information].map((e) => e.rule.id)));
  groups.push(...items.filter((e) => !used.has(e.rule.id) && assessmentRole(e.rule) === 'information')
    .map((e) => ({ eval: e, alternatives: [], information: [] })));
  const period = (c: Cond | null): string => {
    if (!c) return '';
    if (c.op === 'AND' || c.op === 'OR') return unique(c.conditions.map(period));
    if (c.op === 'NOT') return '';
    if ('field' in c && c.field === 'graduationMonthIndex' && c.op === 'range') {
      const month = (n: number) => `${Math.floor(n / 100)}년 ${n % 100}월`;
      return unique([c.min === null ? '' : `${month(c.min)} 졸업부터`, c.max === null ? '' : `${month(c.max)} 졸업까지`]);
    }
    return 'field' in c && ['graduationTerm', 'assessmentRegime', 'changedMajor', 'departmentThesisPreviouslyPassed'].includes(c.field)
      ? describeAssessment(c) : '';
  };
  return groups.map((g) => {
    const describe = (e: RuleEval) => unique([assessmentGuideText(e.rule.detail, e.role), period(e.rule.condition),
      e.blockers.length || e.unaskableFields.length ? '적용 범위는 학과 안내 확인' : '']);
    const choices = [describe(g.eval), ...g.alternatives.map(describe)];
    return { id: g.eval.rule.id, scope: g.eval.scope, text: unique([
      choices.length > 1 ? `${choices[0]} · 대체·면제 경로도 있으니 학과 안내를 확인해 주세요.` : choices[0],
    ]) };
  });
}
