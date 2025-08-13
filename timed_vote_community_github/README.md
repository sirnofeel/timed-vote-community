
# 타임드 투표 커뮤니티 (로그인 필수 + 결과 10분 지연 공개)

이 저장소는 **로그인 필수**, **투표 결과는 마감 10분 후 공개**되는 커뮤니티의 실행 가능한 예제입니다.

## 로컬 실행
```bash
npm install
npm start
# http://localhost:4000
```

## 한 번에 배포 (Render 권장)
1. 이 코드를 GitHub 저장소에 업로드 (이 폴더 그대로)
2. [https://render.com](https://render.com) 가입 → **New + → Web Service**
3. GitHub 연결 → 방금 만든 저장소 선택
4. (자동) `render.yaml` 설정을 읽어서 배포가 진행됩니다
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 배포 완료 후 `https://<프로젝트이름>.onrender.com` 링크로 접속

## 기능
- 회원가입/로그인 (세션 쿠키)
- 주제 생성(제목/설명/선택지≥2/마감 시각)
- 투표(로그인 사용자 1인 1표)
- **마감 + 10분 뒤** 결과 공개
- 파일 저장(`data.json`) — 데모용

## 구조
```
server.js
public/
  ├─ login.html
  ├─ index.html
  ├─ new.html
  ├─ topic.html
  └─ style.css
package.json
render.yaml
.gitignore
```

> 운영 시에는 DB(SQL) 및 세션 저장소(Redis) 사용을 권장합니다.
