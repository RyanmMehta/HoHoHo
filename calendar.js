export function calendarUrl(event){
 // November and December 2026 evening blocks are in Eastern Standard Time.
 const start=new Date(event.date+'T19:00:00-05:00');
 const end=new Date(start.getTime()+5*60*60*1000);
 const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace('.000','');
 const query=new URLSearchParams({action:'TEMPLATE',text:event.title,dates:stamp(start)+'/'+stamp(end),ctz:'America/New_York',details:'HoHoHo with Ryan · 7 p.m.–midnight, New York time. Check the website for updates.',location:event.location});
 return 'https://calendar.google.com/calendar/r/eventedit?'+query;
}
export async function renderHangouts(container){
 container.textContent='Loading hangouts…';
 try{const response=await fetch('/api/hangouts');if(!response.ok)throw new Error();const {hangouts}=await response.json();container.replaceChildren();
 if(!hangouts.length){container.textContent='No hangouts announced yet. Ryan will choose dates once everyone responds.';return}
 for(const event of hangouts){const card=document.createElement('div');card.className='calendar-card';const title=document.createElement('h2');title.textContent=event.title;const detail=document.createElement('p');detail.textContent=new Date(event.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · 7 p.m.–midnight · New York time';const location=document.createElement('p');location.textContent=event.location;const link=document.createElement('a');link.className='calendar-link';link.href=calendarUrl(event);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Add to Google Calendar ↗';const note=document.createElement('p');note.className='privacy-note';note.textContent='Save the event in Google Calendar to reserve the evening. Changes here won’t update your saved event automatically.';card.append(title,detail,location,link,note);container.append(card)}
 }catch{container.textContent='Could not load hangouts. Please refresh to try again.'}
}
