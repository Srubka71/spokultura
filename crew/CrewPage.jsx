import React from 'react';
import crewData from './crew_data.json';

const MemberCard = ({ member }) => {
  return (
    <div className="border border-neutral-800 bg-neutral-900/80 rounded-xl overflow-hidden shadow-lg hover:border-orange-500 transition-all duration-300 flex flex-col justify-between">
      <div>
        <div className="h-72 overflow-hidden relative">
          <img 
            src={member.image} 
            alt={member.name} 
            className="w-full h-full object-cover object-center hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              e.target.src = `https://via.placeholder.com/400x400/111111/ff6a00?text=${encodeURIComponent(member.name)}`;
            }}
          />
        </div>
        <div className="p-6">
          <span className="text-xs uppercase tracking-widest text-orange-500 font-bold">{member.role}</span>
          <h3 className="text-2xl font-black text-white mt-1 mb-3 uppercase">{member.name}</h3>
          <p className="text-neutral-400 text-sm leading-relaxed">{member.bio}</p>
        </div>
      </div>

      {member.socials && Object.keys(member.socials).length > 0 && (
        <div className="px-6 pb-6 pt-3 border-t border-neutral-800/60 flex gap-4">
          {member.socials.instagram && (
            <a 
              href={member.socials.instagram} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 text-sm font-semibold transition-colors"
            >
              Instagram &rarr;
            </a>
          )}
          {member.socials.youtube && (
            <a 
              href={member.socials.youtube} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-red-500 hover:text-red-400 text-sm font-semibold transition-colors"
            >
              YouTube &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default function CrewPage() {
  return (
    <div className="bg-black text-white min-h-screen py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white mb-4">
            SPOKULTURA <span className="text-orange-500">CREW</span>
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Poznaj ludzi, którzy tworzą i napędzają naszą ekipę – DJ-e, tancerze i artyści graffiti.
          </p>
        </header>

        {/* SEKCJA DJ'S */}
        {crewData.djs?.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-extrabold text-orange-500 mb-8 border-b border-neutral-800 pb-3 uppercase tracking-wider">
              DJ'S
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {crewData.djs.map((dj) => (
                <MemberCard key={dj.id} member={dj} />
              ))}
            </div>
          </section>
        )}

        {/* SEKCJA B-BOYS */}
        {crewData.bboys?.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-extrabold text-orange-500 mb-8 border-b border-neutral-800 pb-3 uppercase tracking-wider">
              B-BOYS (TANCERZE)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {crewData.bboys.map((bboy) => (
                <MemberCard key={bboy.id} member={bboy} />
              ))}
            </div>
          </section>
        )}

        {/* SEKCJA WRITERZY */}
        {crewData.writers?.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-extrabold text-orange-500 mb-8 border-b border-neutral-800 pb-3 uppercase tracking-wider">
              WRITERZY (GRAFFITI)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {crewData.writers.map((writer) => (
                <MemberCard key={writer.id} member={writer} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}