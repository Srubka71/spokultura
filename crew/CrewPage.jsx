import React from 'react';
import crewData from './crew_data.json';

const MemberCard = ({ member }) => {
  return (
    <div className="crew-card border border-neutral-800 bg-neutral-900 rounded-lg overflow-hidden shadow-lg hover:border-orange-500 transition-all duration-300">
      <div className="crew-image-container h-72 overflow-hidden relative">
        <img 
          src={member.image} 
          alt={member.name} 
          className="w-full h-full object-cover object-center hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="p-6">
        <span className="text-xs uppercase tracking-widest text-orange-500 font-semibold">{member.role}</span>
        <h3 className="text-2xl font-bold text-white mt-1 mb-3">{member.name}</h3>
        <p className="text-neutral-400 text-sm leading-relaxed mb-4">{member.bio}</p>
        
        {member.socials && Object.keys(member.socials).length > 0 && (
          <div className="flex gap-4 pt-2 border-t border-neutral-800">
            {member.socials.instagram && (
              <a 
                href={member.socials.instagram} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
              >
                Instagram &rarr;
              </a>
            )}
            {member.socials.youtube && (
              <a 
                href={member.socials.youtube} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-red-500 hover:text-red-400 text-sm font-medium transition-colors"
              >
                YouTube &rarr;
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default function CrewPage() {
  return (
    <div className="crew-container bg-black text-white min-h-screen py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-4">
            SPOKULTURA <span className="text-orange-500">CREW</span>
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Poznaj ludzi, ktorzy tworza i napedzaja nasza ekipe – DJ-e, tancerze, tancerki i artysci graffiti.
          </p>
        </header>

        {/* DJ'S SECTION */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-orange-500 mb-8 border-b border-neutral-800 pb-3">DJ'S</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
            {crewData.djs.map((dj) => (
              <MemberCard key={dj.id} member={dj} />
            ))}
          </div>
        </section>

        {/* B-BOYS SECTION */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-orange-500 mb-8 border-b border-neutral-800 pb-3">B-BOYS (TANCERZE)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
            {crewData.bboys.map((bboy) => (
              <MemberCard key={bboy.id} member={bboy} />
            ))}
          </div>
        </section>

        {/* WRITERS SECTION */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-orange-500 mb-8 border-b border-neutral-800 pb-3">WRITERZY (GRAFFITI)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
            {crewData.writers.map((writer) => (
              <MemberCard key={writer.id} member={writer} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}